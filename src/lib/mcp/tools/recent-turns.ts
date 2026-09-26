import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { toTurnJson, type DeskRow } from "../desk-text";

export default defineTool({
  name: "list_recent_turns",
  title: "List recent desk messages",
  description: "Return the most recent messages from the Marginalia desk conversation, oldest first.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("How many messages to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not signed in.");
    const { data, error } = await supabaseForUser(ctx)
      .from("chat_messages")
      .select("sdk_id, role, content, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new ToolError(error.message);
    const turns = ((data ?? []) as DeskRow[]).reverse().map(toTurnJson);
    const text = turns.length
      ? turns.map((t) => `[${t.role} · ${t.createdAt}]\n${t.text}`).join("\n\n")
      : "The desk is empty, or this account is not the desk owner.";
    return { content: [{ type: "text", text }], structuredContent: { turns } };
  },
});
