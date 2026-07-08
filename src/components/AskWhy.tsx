"use client";

import { useEffect, useRef, useState } from "react";
import type { EvidenceQuality } from "@/server/archaeology/types";

type SlimCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  date: string;
  url: string;
  prNumber: number | null;
  isIntroduction: boolean;
};
type SlimRef = { number: number; title: string; url: string };
type Evidence = { commits: SlimCommit[]; prs: SlimRef[]; issues: SlimRef[] };
type Citation = { type: "commit" | "pr" | "issue"; ref: string };
type Claim = { text: string; kind: "explicit" | "inferred"; citations: Citation[] };
type Counts = { commits: number; prs: number; issues: number };

type Result =
  | {
      kind: "answer";
      verdict: Claim;
      claims: Claim[];
      timeline: { evidence: Citation; summary: string }[];
      dropped: { claims: number; timeline: number; citations: number };
    }
  | { kind: "insufficient"; message: string; gated: boolean };

type Stage = "idle" | "evidence" | "narrating" | "done";

const BADGE_STYLES: Record<string, string> = {
  rich: "border-emerald-700 bg-emerald-950/60 text-emerald-200",
  partial: "border-amber-700 bg-amber-950/60 text-amber-200",
  poor: "border-red-800 bg-red-950/60 text-red-200",
};

/**
 * The evidence-quality banner. Deliberately the FIRST and largest thing in
 * every answer — and it renders as soon as the evidence phase returns, before
 * the narrative exists. Reasons render verbatim from the engine.
 */
function QualityBanner({ quality }: { quality: EvidenceQuality }) {
  return (
    <div className={`rounded-lg border p-4 ${BADGE_STYLES[quality.label]}`}>
      <div className="flex items-baseline gap-3">
        <span className="text-lg font-semibold uppercase tracking-wide">
          {quality.label === "rich" && "● Rich evidence"}
          {quality.label === "partial" && "◐ Partial evidence"}
          {quality.label === "poor" && "○ Poor evidence"}
        </span>
        <span className="text-sm opacity-80">
          {quality.informativeUnits} informative source{quality.informativeUnits === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="mt-2 space-y-0.5 text-sm opacity-90">
        {quality.reasons.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>
    </div>
  );
}

function citationHref(c: Citation, ev: Evidence): string | null {
  if (c.type === "commit") {
    return ev.commits.find((x) => x.sha.startsWith(c.ref.toLowerCase()))?.url ?? null;
  }
  const list = c.type === "pr" ? ev.prs : ev.issues;
  return list.find((x) => x.number === Number(c.ref.replace(/^#/, "")))?.url ?? null;
}

function citationLabel(c: Citation): string {
  if (c.type === "commit") return c.ref.slice(0, 7);
  return `${c.type === "pr" ? "PR" : "issue"} #${c.ref.replace(/^#/, "")}`;
}

function CitationChips({ citations, evidence }: { citations: Citation[]; evidence: Evidence }) {
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {citations.map((c, i) => {
        const href = citationHref(c, evidence);
        const label = citationLabel(c);
        return href ? (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300 hover:bg-zinc-700"
          >
            {label}
          </a>
        ) : (
          <span key={i} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-500">
            {label}
          </span>
        );
      })}
    </span>
  );
}

function FeedbackButtons({ queryId }: { queryId: number }) {
  const [sent, setSent] = useState<"up" | "down" | null>(null);

  async function send(rating: "up" | "down") {
    setSent(rating); // optimistic; a failed write is not worth interrupting the reader
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queryId, rating }),
    }).catch(() => {});
  }

  return (
    <div className="flex items-center gap-3 text-sm text-zinc-500">
      <span>Was this answer accurate?</span>
      <button
        onClick={() => send("up")}
        className={`rounded border px-2 py-1 ${sent === "up" ? "border-emerald-600 text-emerald-400" : "border-zinc-700 hover:bg-zinc-800"}`}
        aria-label="Accurate"
      >
        👍
      </button>
      <button
        onClick={() => send("down")}
        className={`rounded border px-2 py-1 ${sent === "down" ? "border-red-700 text-red-400" : "border-zinc-700 hover:bg-zinc-800"}`}
        aria-label="Inaccurate"
      >
        👎
      </button>
      {sent && <span className="text-zinc-600">thanks — this trains what we fix next</span>}
    </div>
  );
}

function Progress({ stage, counts, seconds }: { stage: Stage; counts: Counts | null; seconds: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-300" />
      {stage === "evidence" && <span>Excavating region history — commits, pull requests, issues…</span>}
      {stage === "narrating" && counts && (
        <span>
          Reconstructing intent from {counts.commits} commits · {counts.prs} PRs · {counts.issues}{" "}
          issues — every sentence will be checked against this evidence ({seconds}s)
        </span>
      )}
    </div>
  );
}

const BYOK_STORAGE_KEY = "trace:anthropic-key";

/**
 * Free-trial meter + bring-your-own-key entry. The key lives in
 * localStorage only — sent per-request to our explain endpoint (which
 * forwards it to Anthropic and never stores or logs it).
 */
function KeyPanel({ onSave }: { onSave: (key: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-4">
      <p className="text-sm text-amber-200">
        You&apos;ve used your 3 free traces. Add your own Anthropic API key to keep going — it
        stays in your browser, we never store it.
      </p>
      <p className="mt-1 text-xs text-amber-200/70">
        Get a key at{" "}
        <a
          href="https://console.anthropic.com"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          console.anthropic.com
        </a>
        . Queries with your key bill your Anthropic account and skip Trace&apos;s limits.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSave(value.trim());
        }}
      >
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-ant-…"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
          autoComplete="off"
        />
        <button className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white">
          Save key
        </button>
      </form>
    </div>
  );
}

export function AskWhy({ repoId }: { repoId: number }) {
  const [path, setPath] = useState("");
  const [startLine, setStartLine] = useState("1");
  const [endLine, setEndLine] = useState("40");
  const [byok, setByok] = useState<string | null>(null);
  const [free, setFree] = useState<{ used: number; cap: number } | null>(null);
  const [upsell, setUpsell] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<EvidenceQuality | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [queryId, setQueryId] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const runId = useRef(0);

  useEffect(() => {
    setByok(localStorage.getItem(BYOK_STORAGE_KEY));
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => u && setFree({ used: u.freeUsed, cap: u.freeCap }))
      .catch(() => {});
  }, []);

  function saveKey(key: string) {
    localStorage.setItem(BYOK_STORAGE_KEY, key);
    setByok(key);
    setUpsell(false);
    setError(null);
  }

  function removeKey() {
    localStorage.removeItem(BYOK_STORAGE_KEY);
    setByok(null);
  }

  useEffect(() => {
    if (stage !== "narrating") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const run = ++runId.current;
    setStage("evidence");
    setError(null);
    setQuality(null);
    setCounts(null);
    setResult(null);
    setEvidence(null);
    setQueryId(null);

    const body = { path, startLine: Number(startLine), endLine: Number(endLine) };
    try {
      // Phase 1: fast — evidence + quality. Insufficient regions end here.
      const res1 = await fetch(`/api/repos/${repoId}/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, phase: "evidence" }),
      });
      const p1 = await res1.json();
      if (run !== runId.current) return;
      if (!res1.ok) {
        setError(p1.error ?? "Something went wrong");
        setStage("idle");
        return;
      }
      setQuality(p1.quality);
      if (p1.result) {
        // Gated insufficient: done, no narrative phase.
        setResult(p1.result);
        setEvidence(p1.evidence);
        setQueryId(p1.queryId ?? null);
        setStage("done");
        return;
      }
      setCounts(p1.counts);
      setStage("narrating");

      // Phase 2: the narrative. BYOK rides along per-request, never stored.
      const res2 = await fetch(`/api/repos/${repoId}/explain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(byok ? { "x-anthropic-key": byok } : {}),
        },
        body: JSON.stringify({ ...body, phase: "answer" }),
      });
      const p2 = await res2.json();
      if (run !== runId.current) return;
      if (res2.status === 402) {
        setUpsell(true);
        setStage("idle");
        return;
      }
      if (!res2.ok) {
        setError(p2.error ?? "Something went wrong");
        setStage("idle");
        return;
      }
      if (!byok) setFree((f) => (f ? { ...f, used: f.used + 1 } : f));
      setQuality(p2.quality);
      setResult(p2.result);
      setEvidence(p2.evidence);
      setQueryId(p2.queryId ?? null);
      setStage("done");
    } catch {
      if (run !== runId.current) return;
      setError("Network error — try again");
      setStage("idle");
    }
  }

  const busy = stage === "evidence" || stage === "narrating";

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Why does this code exist?
        </h2>
        <span className="text-xs text-zinc-500">
          {byok ? (
            <>
              using your API key ·{" "}
              <button onClick={removeKey} className="underline hover:text-zinc-300">
                remove
              </button>
            </>
          ) : free ? (
            `${Math.max(0, free.cap - free.used)} of ${free.cap} free traces left`
          ) : null}
        </span>
      </div>

      {!byok && (upsell || (free && free.used >= free.cap)) && <KeyPanel onSave={saveKey} />}

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-zinc-500">file path</span>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="src/index.ts"
            required
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-zinc-500">from line</span>
          <input
            value={startLine}
            onChange={(e) => setStartLine(e.target.value)}
            type="number"
            min={1}
            required
            className="w-24 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-zinc-500">to line</span>
          <input
            value={endLine}
            onChange={(e) => setEndLine(e.target.value)}
            type="number"
            min={1}
            required
            className="w-24 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
          />
        </label>
        <button
          disabled={busy}
          className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Digging…" : "Ask why"}
        </button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {quality && <QualityBanner quality={quality} />}
      {busy && <Progress stage={stage} counts={counts} seconds={seconds} />}

      {stage === "done" && result && evidence && (
        <div className="space-y-4">
          {result.kind === "insufficient" ? (
            <div className="rounded-lg border border-zinc-700 p-5">
              <p className="text-lg text-zinc-200">{result.message}</p>
              <p className="mt-1 text-sm text-zinc-500">
                Trace does not invent history. Here is everything the record holds for this region:
              </p>
              <ul className="mt-3 space-y-1 font-mono text-sm text-zinc-400">
                {evidence.commits.map((c) => (
                  <li key={c.sha}>
                    <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-zinc-200">
                      {c.shortSha} {c.date.slice(0, 10)} {c.subject}
                      {c.isIntroduction ? "  [introduction]" : ""}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-zinc-800 p-5">
                <p className="text-lg text-zinc-100">
                  {result.verdict.text}
                  <CitationChips citations={result.verdict.citations} evidence={evidence} />
                </p>
              </div>

              {result.timeline.length > 0 && (
                <div className="rounded-lg border border-zinc-800 p-5">
                  <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Evolution
                  </h3>
                  <ol className="space-y-2 text-sm text-zinc-300">
                    {result.timeline.map((t, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-zinc-600">{i + 1}.</span>
                        <span>
                          {t.summary}
                          <CitationChips citations={[t.evidence]} evidence={evidence} />
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {result.claims.length > 0 && (
                <div className="rounded-lg border border-zinc-800 p-5">
                  <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    The story, sentence by sentence
                  </h3>
                  <ul className="space-y-2 text-sm text-zinc-300">
                    {result.claims.map((c, i) => (
                      <li key={i}>
                        {c.kind === "inferred" && (
                          <span
                            className="mr-1 rounded bg-zinc-800 px-1 text-xs text-zinc-500"
                            title="Deduced from diffs/timing, not stated in the evidence"
                          >
                            inferred
                          </span>
                        )}
                        {c.text}
                        <CitationChips citations={c.citations} evidence={evidence} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.dropped.claims + result.dropped.timeline > 0 && (
                <p className="text-xs text-zinc-600">
                  {result.dropped.claims + result.dropped.timeline} unverifiable statement
                  {result.dropped.claims + result.dropped.timeline === 1 ? "" : "s"} were removed by
                  the citation validator.
                </p>
              )}

              {queryId !== null && <FeedbackButtons queryId={queryId} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
