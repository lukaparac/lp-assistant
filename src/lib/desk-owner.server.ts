import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Verifies a bearer token belongs to the desk owner (admin role). Returns the user id or null. */
export async function verifyDeskOwner(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.split(".").length !== 3) return null;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  const client = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  const { data: isAdmin, error: roleError } = await client.rpc("has_role", {
    _user_id: sub,
    _role: "admin",
  });
  if (roleError || isAdmin !== true) return null;
  return sub;
}
