"use client";

import { useEffect, useState } from "react";
import type { PublicRepo } from "@/server/dto";
import { AskWhy } from "./AskWhy";
import { SignalBadge, StatusBadge } from "./badges";

const ACTIVE = new Set(["queued", "cloning", "fetching_prs", "scoring"]);

export function RepoStatusView({ initial }: { initial: PublicRepo }) {
  const [repo, setRepo] = useState(initial);

  useEffect(() => {
    if (!ACTIVE.has(repo.status)) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/repos/${repo.id}`);
      if (res.ok) setRepo(await res.json());
    }, 2000);
    return () => clearInterval(t);
  }, [repo.id, repo.status]);

  return (
    <div className="mt-6 space-y-6">
      <div className="flex items-center gap-3">
        <StatusBadge status={repo.status} />
        {repo.signal && <SignalBadge signal={repo.signal} />}
      </div>

      {ACTIVE.has(repo.status) && (
        <div className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">
          {repo.status === "queued" && <p>Waiting for an ingest slot…</p>}
          {repo.status === "cloning" && <p>Cloning repository (bare, default branch only)…</p>}
          {repo.status === "fetching_prs" && (
            <p>
              Fetching merged pull requests — {repo.prCount} PRs across {repo.prPagesFetched}{" "}
              page{repo.prPagesFetched === 1 ? "" : "s"} so far…
            </p>
          )}
          {repo.status === "scoring" && <p>Scoring the repository’s why-signal…</p>}
          {repo.error && <p className="mt-2 text-amber-400">{repo.error}</p>}
        </div>
      )}

      {repo.status === "failed" && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          Ingest failed: {repo.error ?? "unknown error"}
        </div>
      )}

      {repo.status === "ready" && repo.signal && (
        <div className="rounded-lg border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Why-signal report
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-zinc-500">Score</dt>
              <dd className="text-lg">{repo.signal.score}/100</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Commits</dt>
              <dd className="text-lg">{repo.signal.totalCommits.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Commits traceable to a PR</dt>
              <dd className="text-lg">{repo.signal.pctCommitsWithPr}%</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Descriptive commit messages</dt>
              <dd className="text-lg">{repo.signal.pctDescriptiveMessages}%</dd>
            </div>
          </dl>
          {repo.signal.initialCommitDump && (
            <p className="mt-3 text-sm text-amber-400">
              History begins with a bulk import — origins before that commit predate this
              repository and can’t be recovered from git.
            </p>
          )}
          <p className="mt-4 border-t border-zinc-800 pt-3 text-sm text-zinc-500">
            {repo.prCount.toLocaleString()} merged PRs ingested.
          </p>
        </div>
      )}

      {repo.status === "ready" && <AskWhy repoId={repo.id} />}
    </div>
  );
}
