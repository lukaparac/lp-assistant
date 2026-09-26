import { createServerFn } from "@tanstack/react-start";
import type { UIMessage } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertOwner(supabase: { rpc: (...a: never[]) => unknown }, userId: string) {
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: object,
    ) => Promise<{ data: unknown; error: unknown }>
  )("has_role", { _user_id: userId, _role: "admin" });
  if (error || data !== true) throw new Response("Forbidden", { status: 403 });
}

type HistoryRow = {
  sdk_id: string;
  role: string;
  content: unknown;
  created_at: string;
};

export type DeskMessage = UIMessage;

/** Reading, counting and clearing the desk all happen on the server, so the
 *  table itself needs no browser-facing access rules. */
export const fetchHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("sdk_id, role, content, created_at")
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as unknown as HistoryRow[])
      .filter((row) => row.role === "user" || row.role === "assistant")
      .map((row) => {
        const content = (row.content ?? {}) as UIMessage;
        return {
          ...content,
          id: content.id || row.sdk_id,
          role: row.role as "user" | "assistant",
          metadata: { ...((content.metadata ?? {}) as object), createdAt: row.created_at },
        } as UIMessage;
      });

    // Serialized as JSON so the server-function boundary stays type-safe.
    return JSON.stringify(rows);
  });

export const fetchTurnCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await supabaseAdmin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("role", "user");

    if (error) throw new Error(error.message);
    return count ?? 0;
  });

export const clearDeskMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("chat_messages").delete().not("sdk_id", "is", null);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
