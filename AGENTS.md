<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

<!-- LOVABLE:BEGIN-PROJECT -->
> [!NOTE]
> Attachments are converted on both sides of the wire: the browser rewrites its own `blob:` file
> URLs to `data:` URLs before sending (the server cannot read a tab's blob URLs), and the server
> decodes any textual attachment into a text part before the model call, because the model provider
> only accepts images and PDFs as real files. Keep both steps — dropping either silently loses
> documents from the answer.
<!-- LOVABLE:END-PROJECT -->
- MCP server (src/lib/mcp/) uses Supabase OAuth; desk reads go through RLS that allows only the admin role (first signed-up account) — keeps the no-login desk private to its owner.
- Visitor mode (BYO key): `/api/public/chat` accepts a `visitorKey` in the body — ephemeral client-supplied history, direct provider call with the caller's key, never persisted and never logged (scrubbed from errors). Only the owner path may use the workspace's `LOVABLE_API_KEY` and `chat_messages`. Why: lets others use the desk without spending the owner's credits.
- The CI logging check covers `src/lib/chat.server.ts`, so never add raw console.log/warn/info there — the visitor key must only ever pass through the redacted error path.
