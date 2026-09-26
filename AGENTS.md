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
