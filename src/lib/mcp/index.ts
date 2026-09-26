import { auth, defineMcp } from "@lovable.dev/mcp-js";
import recentTurns from "./tools/recent-turns";
import searchDesk from "./tools/search-desk";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "companion-ai-builder",
  title: "Companion AI Builder",
  version: "0.1.0",
  instructions:
    "Read-only access to the owner's Marginalia research desk. Use `list_recent_turns` to see the latest conversation and `search_desk` to find earlier notes.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [recentTurns, searchDesk],
});
