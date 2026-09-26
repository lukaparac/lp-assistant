import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ next: safeNext(s.next) }),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) window.location.replace(search.next);
  },
  head: () => ({
    meta: [
      { title: "Sign in — Marginalia" },
      { name: "description", content: "Sign in to connect an assistant to your Marginalia desk." },
      { property: "og:title", content: "Sign in — Marginalia" },
      { property: "og:description", content: "Sign in to connect an assistant to your desk." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Login,
});

function Login() {
  const { next } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    const target = `${window.location.origin}${next}`;
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: target });
    if (result.error) {
      setBusy(false);
      setError(result.error.message);
      return;
    }
    if (!result.redirected) window.location.href = target;
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="glass w-full max-w-sm space-y-4 rounded-2xl p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Sign in to your desk</h1>
        <p className="text-sm text-muted-foreground">
          Needed only to connect an outside assistant. The first account becomes the desk's owner.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button className="w-full" disabled={busy} onClick={signIn}>
          Continue with Google
        </Button>
      </div>
    </main>
  );
}
