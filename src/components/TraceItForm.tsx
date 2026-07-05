"use client";

import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  authed: boolean;
  login: string | null;
};

/**
 * The landing-page form. Unauthenticated: "Trace it" starts GitHub OAuth with
 * the typed URL carried through as ?repo=, and submission resumes
 * automatically after the OAuth redirect lands back here. Authenticated:
 * submits straight to POST /api/repos and redirects to the status page.
 */
export function TraceItForm({ authed, login }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resumed = useRef(false);

  const submit = useCallback(
    async (repoUrl: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/repos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: repoUrl }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Something went wrong");
          setBusy(false);
          return;
        }
        // Deliberately stay busy through the redirect to the status page.
        router.push(`/repos/${body.id}`);
      } catch {
        setError("Network error — try again");
        setBusy(false);
      }
    },
    [router],
  );

  // Post-OAuth resume: the repo URL survives the round trip as ?repo=.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("repo");
    if (!param || resumed.current) return;
    resumed.current = true;
    window.history.replaceState(null, "", "/");
    setUrl(param);
    if (authed) void submit(param);
  }, [authed, submit]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!authed) {
      setBusy(true);
      void signIn("github", { callbackUrl: `/?repo=${encodeURIComponent(trimmed)}` });
      return;
    }
    void submit(trimmed);
  }

  return (
    <form onSubmit={onSubmit} className="contents">
      <input
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm"
        placeholder="Paste GitHub repo URL..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        spellCheck={false}
        required
      />

      <button
        className="rounded-lg bg-zinc-100 px-5 py-2.5 font-medium text-zinc-900 disabled:opacity-50"
        disabled={busy}
      >
        {busy ? "Working…" : "Trace it"}
      </button>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {authed ? (
        <p className="text-xs text-zinc-500">
          Signed in as {login} ·{" "}
          <button type="button" onClick={() => signOut()} className="underline hover:text-zinc-300">
            sign out
          </button>
        </p>
      ) : (
        <p className="text-xs text-zinc-500">
          Tracing signs you in with GitHub — no scopes requested, public repos only.
        </p>
      )}
    </form>
  );
}
