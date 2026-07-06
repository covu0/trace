"use client";

import { useState } from "react";
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
type Citation = { type: "commit" | "pr" | "issue"; ref: string };
type Claim = { text: string; kind: "explicit" | "inferred"; citations: Citation[] };

type ExplainResponse = {
  quality: EvidenceQuality;
  result:
    | {
        kind: "answer";
        verdict: Claim;
        claims: Claim[];
        timeline: { evidence: Citation; summary: string }[];
        dropped: { claims: number; timeline: number; citations: number };
      }
    | { kind: "insufficient"; message: string; gated: boolean };
  evidence: { commits: SlimCommit[]; prs: SlimRef[]; issues: SlimRef[] };
};

const BADGE_STYLES: Record<string, string> = {
  rich: "border-emerald-700 bg-emerald-950/60 text-emerald-200",
  partial: "border-amber-700 bg-amber-950/60 text-amber-200",
  poor: "border-red-800 bg-red-950/60 text-red-200",
};

/**
 * The evidence-quality banner. Deliberately the FIRST and largest thing in
 * every answer: the reader learns how much to trust the answer before they
 * read a word of it. Reasons render verbatim from the engine.
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

function citationHref(c: Citation, ev: ExplainResponse["evidence"]): string | null {
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

function CitationChips({ citations, evidence }: { citations: Citation[]; evidence: ExplainResponse["evidence"] }) {
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

export function AskWhy({ repoId }: { repoId: number }) {
  const [path, setPath] = useState("");
  const [startLine, setStartLine] = useState("1");
  const [endLine, setEndLine] = useState("40");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExplainResponse | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, startLine: Number(startLine), endLine: Number(endLine) }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Something went wrong");
      else setData(body);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Why does this code exist?
      </h2>
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

      {data && (
        <div className="space-y-4">
          <QualityBanner quality={data.quality} />

          {data.result.kind === "insufficient" ? (
            <div className="rounded-lg border border-zinc-700 p-5">
              <p className="text-lg text-zinc-200">{data.result.message}</p>
              <p className="mt-1 text-sm text-zinc-500">
                Trace does not invent history. Here is everything the record holds for this region:
              </p>
              <ul className="mt-3 space-y-1 font-mono text-sm text-zinc-400">
                {data.evidence.commits.map((c) => (
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
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-800 p-5">
                <p className="text-lg text-zinc-100">
                  {data.result.verdict.text}
                  <CitationChips citations={data.result.verdict.citations} evidence={data.evidence} />
                </p>
              </div>

              {data.result.timeline.length > 0 && (
                <div className="rounded-lg border border-zinc-800 p-5">
                  <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Evolution
                  </h3>
                  <ol className="space-y-2 text-sm text-zinc-300">
                    {data.result.timeline.map((t, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-zinc-600">{i + 1}.</span>
                        <span>
                          {t.summary}
                          <CitationChips citations={[t.evidence]} evidence={data.evidence} />
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {data.result.claims.length > 0 && (
                <div className="rounded-lg border border-zinc-800 p-5">
                  <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    The story, sentence by sentence
                  </h3>
                  <ul className="space-y-2 text-sm text-zinc-300">
                    {data.result.claims.map((c, i) => (
                      <li key={i}>
                        {c.kind === "inferred" && (
                          <span className="mr-1 rounded bg-zinc-800 px-1 text-xs text-zinc-500" title="Deduced from diffs/timing, not stated in the evidence">
                            inferred
                          </span>
                        )}
                        {c.text}
                        <CitationChips citations={c.citations} evidence={data.evidence} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.result.dropped.claims + data.result.dropped.timeline > 0 && (
                <p className="text-xs text-zinc-600">
                  {data.result.dropped.claims + data.result.dropped.timeline} unverifiable statement
                  {data.result.dropped.claims + data.result.dropped.timeline === 1 ? "" : "s"} were
                  removed by the citation validator.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
