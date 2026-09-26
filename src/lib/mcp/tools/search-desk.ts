import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { toTurnJson, type DeskRow } from "../desk-text";

export default defineTool({
  name: "search_desk",
  title: "Search the desk",
  description: "Find desk messages whose text contains the given words (case-insensitive).",
  inputSchema: {
    query: z.string().trim().min(1).describe("Words to look for."),
    limit: z.number().int().min(1).max(50).default(10).describe("Maximum matches to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not signed in.");
    const { data, error } = await supabaseForUser(ctx)
      .from("chat_messages")
      .select("sdk_id, role, content, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new ToolError(error.message);
    const needle = query.toLowerCase();
    const matches = ((data ?? []) as DeskRow[])
      .map(toTurnJson)
      .filter((t) => t.text.toLowerCase().includes(needle))
      .slice(-limit);
    const text = matches.length
      ? matches.map((t) => `[${t.role} · ${t.createdAt}]\n${t.text}`).join("\n\n")
      : `No messages mention "${query}".`;
    return { content: [{ type: "text", text }], structuredContent: { matches } };
  },
});
