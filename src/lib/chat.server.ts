import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText, type ToolSet, type UIMessage } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { modeInstruction, modeLabel } from "./modes";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./ai/run-id.server";

const GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";
const CHAT_MODEL = "openai/gpt-6-astra";

/** Guardrails so one browser tab can't grow the desk without limit. */
const MAX_MESSAGES = 240;
const MAX_BODY_BYTES = 40 * 1024 * 1024;

const SYSTEM_PROMPT = `You are Marginalia, a research and writing assistant on one person's desk.

How you work:
- You have live web search. Use it whenever the answer depends on anything you did not learn with certainty — current events, prices, versions, statistics, people, companies, or anything the reader might want to check. Searching is cheap; being wrong is not.
- When you searched, cite what you actually used, inline, as markdown links with short descriptive labels, e.g. [the benchmark write-up](https://example.com/bench). Never invent or guess a URL, and never cite a page you did not open in this conversation.
- Prefer primary sources over summaries of them. Keep numbers with their units and their year.
- Write in clear, direct prose. No preamble, no "Certainly!", no "In conclusion". Bullet points only when the content is genuinely a list. No bolding for decoration.
- Never pad. If three sentences answer it, three sentences is the answer.
- If a file is attached, read it before you answer, and quote it exactly where it matters rather than paraphrasing it.
- If you cannot find something or cannot open a source, say so plainly and say what you did find.

You are a tool on a desk, not a customer-service channel. Be calm, specific and a little opinionated when the evidence supports it.`;

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

/** Translate gateway/SDK failures into something a person can act on. */
function describeError(error: unknown): string {
  const status = (error as { statusCode?: number } | undefined)?.statusCode;
  const detail = error instanceof Error ? error.message : String(error ?? "");

  if (status === 401)
    return "Lovable AI rejected this workspace's service key, so nothing was sent.";
  if (status === 402)
    return "Lovable AI has no credits left. Top up in Settings → Plans & credits, then resend.";
  if (status === 403)
    return "Lovable AI refused this request. Nothing was changed — try rephrasing it.";
  if (status === 404) return "Lovable AI could not find the model this desk is configured to use.";
  if (status === 429) return "Lovable AI is rate-limited right now. Wait a few seconds and resend.";
  if (status && status >= 500)
    return "Lovable AI is having trouble at the moment. Try again shortly.";
  return detail || "Something went wrong while answering.";
}

async function persistMessages(messages: UIMessage[]) {
  const rows = messages
    .filter(
      (message) =>
        Boolean(message?.id) && (message.role === "user" || message.role === "assistant"),
    )
    .map((message) => ({
      sdk_id: message.id,
      role: message.role,
      content: JSON.parse(JSON.stringify(message)),
    }));

  if (rows.length === 0) return;

  const { error } = await supabaseAdmin
    .from("chat_messages")
    .upsert(rows, { onConflict: "sdk_id" });
  if (error) throw new Error(`Could not save the conversation: ${error.message}`);
}

export async function handleChat(request: Request): Promise<Response> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return jsonError(500, "Lovable AI isn't configured for this workspace yet.");

  if (
    (request.headers.get("content-length") ?? "") &&
    Number(request.headers.get("content-length")) > MAX_BODY_BYTES
  ) {
    return jsonError(413, "That's too large to send. Try attaching fewer or smaller files.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "The request body wasn't valid JSON.");
  }

  if (!body || typeof body !== "object")
    return jsonError(400, "The request body wasn't an object.");

  const { messages, mode } = body as { messages?: unknown; mode?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, "Nothing was sent to answer.");
  }
  if (messages.length > MAX_MESSAGES) {
    return jsonError(
      413,
      "This conversation has grown past what one request can carry. Clear the desk to start fresh.",
    );
  }

  const history = messages as UIMessage[];
  const modeName = modeLabel(mode);

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(history, { ignoreIncompleteToolCalls: true });
  } catch (error) {
    console.error("Unable to read the incoming conversation:", error);
    return jsonError(400, "The conversation couldn't be read. Try sending your message again.");
  }

  const instructions = `${SYSTEM_PROMPT}\n\nMode: ${modeName}.\n${modeInstruction(mode)}`;

  const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: GATEWAY_BASE_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: gateway.fetch,
  });

  const result = streamText({
    model: provider.responses(CHAT_MODEL),
    instructions,
    messages: modelMessages,
    tools: {
      web_search: provider.tools.webSearch({ searchContextSize: "medium" }),
    } as unknown as ToolSet,
    stopWhen: stepCountIs(50),
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  // Save what arrived first, but never make the answer wait for the write.
  await persistMessages(history).catch((error) => console.error(error));

  const streamResponse = result.toUIMessageStreamResponse({
    originalMessages: history,
    sendReasoning: true,
    sendSources: true,
    onError: (error) => {
      console.error(error);
      return describeError(error);
    },
    onEnd: async ({ messages: all }) => {
      const last = all[all.length - 1];
      if (!last || last.role !== "assistant") return;
      try {
        await persistMessages([last]);
      } catch (error) {
        console.error(error);
      }
    },
  });

  return withLovableAiGatewayRunIdHeader(streamResponse, gateway);
}
