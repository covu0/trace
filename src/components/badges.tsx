import type { RepoStatus, SignalScore } from "@/db/schema";

const STATUS_STYLES: Record<RepoStatus, string> = {
  queued: "bg-zinc-800 text-zinc-300",
  cloning: "bg-blue-950 text-blue-300",
  fetching_prs: "bg-blue-950 text-blue-300",
  scoring: "bg-blue-950 text-blue-300",
  ready: "bg-emerald-950 text-emerald-300",
  failed: "bg-red-950 text-red-300",
};

const STATUS_LABELS: Record<RepoStatus, string> = {
  queued: "queued",
  cloning: "cloning",
  fetching_prs: "fetching PRs",
  scoring: "scoring",
  ready: "ready",
  failed: "failed",
};

export function StatusBadge({ status }: { status: RepoStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const SIGNAL_STYLES: Record<SignalScore["label"], string> = {
  rich: "bg-emerald-950 text-emerald-300",
  moderate: "bg-amber-950 text-amber-300",
  sparse: "bg-red-950 text-red-300",
};

export function SignalBadge({ signal }: { signal: SignalScore }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${SIGNAL_STYLES[signal.label]}`}
      title={`Why-signal ${signal.score}/100 — ${signal.pctCommitsWithPr}% of commits map to a PR, ${signal.pctDescriptiveMessages}% have descriptive messages`}
    >
      signal: {signal.label}
    </span>
  );
}
