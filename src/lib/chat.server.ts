import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type TextUIPart,
  type ToolSet,
  type UIMessage,
} from "ai";
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

/**
 * The model only accepts images and PDFs as real files. Everything else a
 * person drops on the desk (notes, CSVs, code, transcripts) is decoded here
 * and handed over as text so it never gets lost on the way to the model.
 */
const MAX_INLINE_CHARS = 120_000;

function decodeDataUrl(url: string): string | null {
  const match = /^data:([^,]*),([\s\S]*)$/.exec(url);
  if (!match) return null;

  const meta = match[1] ?? "";
  const payload = match[2];
  if (payload === undefined) return null;
  try {
    const text = meta.endsWith(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    // A NUL byte near the front means this is not something to read as text.
    if (text.slice(0, 1024).includes("\u0000")) return null;
    return text;
  } catch {
    return null;
  }
}

function inlineFile(name: string, text: string): TextUIPart {
  const body =
    text.length > MAX_INLINE_CHARS
      ? `${text.slice(0, MAX_INLINE_CHARS)}\n… the rest was cut off.`
      : text;
  return { type: "text", text: `\n<attached-file name="${name}">\n${body}\n</attached-file>\n` };
}

async function inlineTextFiles(messages: UIMessage[]): Promise<UIMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      const parts = message.parts ?? [];
      if (!parts.some((part) => part.type === "file")) return message;

      const next: typeof parts = [];
      for (const part of parts) {
        if (part.type !== "file") {
          next.push(part);
          continue;
        }

        const media = typeof part.mediaType === "string" ? part.mediaType : "";
        if (media.startsWith("image/") || media === "application/pdf") {
          next.push(part);
          continue;
        }

        const url = typeof part.url === "string" ? part.url : "";
        const text = decodeDataUrl(url);
        if (text === null) {
          next.push(part);
          continue;
        }
        next.push(inlineFile(part.filename ?? "attached file", text));
      }

      return { ...message, parts: next };
    }),
  );
}

type HistoryRow = {
  sdk_id: string;
  role: string;
  content: unknown;
  created_at: string;
};

/**
 * The desk's own record of the conversation. Everything the model sees before
 * the newest question comes from here, never from the caller's request body —
 * otherwise anyone could hand us a fake "assistant said this" turn.
 */
async function loadPersistedHistory(): Promise<UIMessage[]> {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("sdk_id, role, content, created_at")
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);

  if (error) throw new Error(`Could not read the conversation: ${error.message}`);

  return ((data ?? []) as unknown as HistoryRow[])
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => {
      const content = (row.content ?? {}) as UIMessage;
      return {
        ...content,
        id: content.id || row.sdk_id,
        role: row.role as "user" | "assistant",
      } as UIMessage;
    });
}

/**
 * Only text and files survive from the request body, and the turn is always a
 * user turn: roles are decided here, not by whoever sent the request.
 */
function sanitizeIncoming(raw: unknown): UIMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { id?: unknown; parts?: unknown; metadata?: unknown };
  if (!Array.isArray(candidate.parts)) return null;

  const parts = candidate.parts.flatMap((part): UIMessage["parts"] => {
    if (!part || typeof part !== "object") return [];
    const p = part as {
      type?: unknown;
      text?: unknown;
      url?: unknown;
      mediaType?: unknown;
      filename?: unknown;
    };
    if (p.type === "text" && typeof p.text === "string") {
      return [{ type: "text", text: p.text }];
    }
    if (p.type === "file" && typeof p.url === "string" && typeof p.mediaType === "string") {
      return [
        {
          type: "file",
          url: p.url,
          mediaType: p.mediaType,
          ...(typeof p.filename === "string" ? { filename: p.filename } : {}),
        },
      ];
    }
    return [];
  });

  if (parts.length === 0) return null;

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : crypto.randomUUID(),
    role: "user",
    parts,
    ...(candidate.metadata && typeof candidate.metadata === "object"
      ? { metadata: candidate.metadata as UIMessage["metadata"] }
      : {}),
  } as UIMessage;
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

  // Only the newest turn is taken from the request, and always as a user turn.
  const incoming = sanitizeIncoming(messages[messages.length - 1]);
  if (!incoming) return jsonError(400, "That message couldn't be read. Try sending it again.");

  let saved: UIMessage[];
  try {
    saved = await loadPersistedHistory();
  } catch (error) {
    console.error(error);
    return jsonError(500, "The desk's saved conversation couldn't be opened just now.");
  }

  const history = [...saved.filter((message) => message.id !== incoming.id), incoming];
  const modeName = modeLabel(mode);

  let modelMessages;
  try {
    const forModel = await inlineTextFiles(history);
    modelMessages = await convertToModelMessages(forModel, { ignoreIncompleteToolCalls: true });
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
  await persistMessages([incoming]).catch((error) => console.error(error));

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
        // The streamed message arrives with an empty id; the desk keys its
        // saved rows by one, so mint it here before writing.
        await persistMessages([{ ...last, id: last.id?.trim() || crypto.randomUUID() }]);
      } catch (error) {
        console.error(error);
      }
    },
  });

  return withLovableAiGatewayRunIdHeader(streamResponse, gateway);
}
