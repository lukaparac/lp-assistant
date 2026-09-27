import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — Marginalia" },
      {
        name: "description",
        content: "How Marginalia handles visitor API keys and who bills you for answers.",
      },
      { property: "og:title", content: "Privacy — Marginalia" },
      {
        property: "og:description",
        content: "Visitor keys stay in your browser tab. OpenAI bills you directly.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Privacy,
});

const sections: { title: string; body: string }[] = [
  {
    title: "Your key stays in your browser",
    body: "When you paste an OpenAI API key, it is kept only in this browser tab's temporary storage. Closing the tab, or choosing “Forget my key”, removes it. It is never saved to an account, a database, or a cookie.",
  },
  {
    title: "How it's used",
    body: "Each time you send a message, your key travels with that one request so the answer can be fetched from OpenAI on your behalf. It is used for that request only, then discarded. It is never written to logs, and error messages have it removed.",
  },
  {
    title: "OpenAI bills you directly",
    body: "Every answer is charged by OpenAI to the account behind your key, at their published rates. This desk never sees your billing details and takes no fee. Set a spending limit in your OpenAI account if you'd like a cap.",
  },
  {
    title: "Your conversation isn't kept",
    body: "Visitor conversations live in the open tab only. Nothing you type or attach is saved here, and it disappears when you close or reload the tab. OpenAI's own data policies apply to what you send them.",
  },
  {
    title: "Changing your mind",
    body: "You can revoke the key at any time at platform.openai.com/api-keys. A revoked key stops working here immediately.",
  },
];

function Privacy() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-14 text-ink">
      <article className="mx-auto max-w-xl space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">Privacy</p>
          <h1 className="text-2xl font-semibold">Visitor keys and billing</h1>
          <p className="text-sm text-ink-soft">
            If you use this desk with your own OpenAI key, here is exactly what happens to it.
          </p>
        </header>
        {sections.map((s) => (
          <section key={s.title} className="space-y-1.5">
            <h2 className="text-base font-semibold">{s.title}</h2>
            <p className="text-sm leading-relaxed text-ink-soft">{s.body}</p>
          </section>
        ))}
        <Link to="/" className="inline-block text-sm font-medium text-brand underline">
          Back to the desk
        </Link>
      </article>
    </main>
  );
}
