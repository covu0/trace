import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIssue } from "@/server/github";
import type { EvidenceCommit, EvidenceIssue, EvidencePr } from "./types";
import { MAX_ISSUES_PER_QUERY } from "./types";

// "fixes #12", "fix for #34", "closes: #56", "issue #78" — and number lists
// ("fix #66 #73"). Only the matched keyword span is scanned for numbers, so
// bare "#N" elsewhere in prose is not treated as a reference.
const ISSUE_REF =
  /(?:close[sd]?|fix(?:e[sd])?(?:\s+for)?|resolve[sd]?|issue|see):?\s+(#\d+(?:[,\s]+(?:and\s+)?#\d+)*)/gi;
// Squash-merge suffix on commit subjects: "feat: retry loop (#123)".
const SUBJECT_PR_REF = /\(#(\d+)\)\s*$/;
// Merge-commit workflow: "Merge pull request #123 from ...". The API's
// merge_commit_sha is unreliable on old PRs (it can point at a test-merge
// commit that never entered the branch), so the subject is the real signal.
const MERGE_SUBJECT_PR_REF = /^Merge pull request #(\d+)\b/;

function extractIssueRefs(text: string): number[] {
  const refs = new Set<number>();
  for (const m of text.matchAll(ISSUE_REF)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) refs.add(Number(n[1]));
  }
  return [...refs];
}

/**
 * Attaches PRs to evidence commits (from the ingest-time mapping plus the
 * squash-subject convention) and resolves issue references from commit
 * messages and PR bodies — fetching issue content lazily via GitHub and
 * caching it. `token` may be empty (unauthenticated, CLI use).
 */
export async function enrich(
  repo: { id: number; owner: string; name: string },
  commits: EvidenceCommit[],
  token: string,
): Promise<{ prs: EvidencePr[]; issues: EvidenceIssue[] }> {
  const d = db();
  const shas = commits.map((c) => c.sha);

  // 1. Commit → PR from the ingest-time mapping table.
  const mapped =
    shas.length === 0
      ? []
      : await d
          .select()
          .from(schema.commitPrMap)
          .where(and(eq(schema.commitPrMap.repoId, repo.id), inArray(schema.commitPrMap.sha, shas)));
  const bySha = new Map(mapped.map((m) => [m.sha, m.prNumber]));

  const prNumbers = new Set<number>();
  for (const c of commits) {
    const fromMap = bySha.get(c.sha);
    const fromSubject =
      SUBJECT_PR_REF.exec(c.subject)?.[1] ?? MERGE_SUBJECT_PR_REF.exec(c.subject)?.[1];
    const pr = fromMap ?? (fromSubject ? Number(fromSubject) : null);
    if (pr !== null) {
      c.prNumber = pr;
      prNumbers.add(pr);
    }
  }

  // 2. Load the referenced PRs we ingested (unknown numbers are dropped —
  //    a subject "(#N)" can be a false positive and must not become evidence).
  const prRows =
    prNumbers.size === 0
      ? []
      : await d
          .select()
          .from(schema.pullRequests)
          .where(
            and(
              eq(schema.pullRequests.repoId, repo.id),
              inArray(schema.pullRequests.number, [...prNumbers]),
            ),
          );
  const knownPr = new Set(prRows.map((p) => p.number));
  for (const c of commits) {
    if (c.prNumber !== null && !knownPr.has(c.prNumber)) c.prNumber = null;
  }
  const prs: EvidencePr[] = prRows.map((p) => ({
    number: p.number,
    title: p.title,
    body: p.body,
    author: p.author,
    mergedAt: p.mergedAt?.toISOString() ?? null,
    url: `https://github.com/${repo.owner}/${repo.name}/pull/${p.number}`,
  }));

  // 3. Issue refs from commit messages and PR bodies. Numbers that are PRs
  //    we already have are PR refs, not issues.
  const issueNumbers = new Set<number>();
  for (const c of commits) for (const n of extractIssueRefs(c.subject + "\n" + c.body)) issueNumbers.add(n);
  for (const p of prs) for (const n of extractIssueRefs(p.body ?? "")) issueNumbers.add(n);
  for (const n of knownPr) issueNumbers.delete(n);

  const wanted = [...issueNumbers].slice(0, MAX_ISSUES_PER_QUERY);
  const issues: EvidenceIssue[] = [];
  if (wanted.length > 0) {
    const cached = await d
      .select()
      .from(schema.issuesCache)
      .where(and(eq(schema.issuesCache.repoId, repo.id), inArray(schema.issuesCache.number, wanted)));
    const cachedByNumber = new Map(cached.map((i) => [i.number, i]));

    for (const n of wanted) {
      const hit = cachedByNumber.get(n);
      if (hit) {
        if (!hit.isPull) {
          issues.push({ number: hit.number, title: hit.title, body: hit.body, url: issueUrl(repo, n) });
        }
        continue;
      }
      // Cache miss → fetch and cache (including "it's actually a PR" and, as
      // a tombstone, nothing for 404s so we retry those next time — rare).
      const fetched = await getIssue(token, repo.owner, repo.name, n).catch(() => null);
      if (!fetched) continue;
      await d
        .insert(schema.issuesCache)
        .values({
          repoId: repo.id,
          number: fetched.number,
          title: fetched.title,
          body: fetched.body,
          isPull: fetched.isPull ? 1 : 0,
        })
        .onConflictDoNothing();
      if (!fetched.isPull) {
        issues.push({ number: fetched.number, title: fetched.title, body: fetched.body, url: issueUrl(repo, n) });
      }
    }
  }

  return { prs, issues };
}

function issueUrl(repo: { owner: string; name: string }, n: number) {
  return `https://github.com/${repo.owner}/${repo.name}/issues/${n}`;
}
