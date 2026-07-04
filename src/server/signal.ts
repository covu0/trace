import { and, count, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SignalScore } from "@/db/schema";
import { commitCount, logSample, rootCommitFileCount } from "./gitrepo";

const SAMPLE_LIMIT = 5000;
const BOT_AUTHOR = /(\[bot\]|dependabot|renovate|github-actions|greenkeeper)/i;
// Squash-merge convention: subject ends with "(#123)".
const SUBJECT_PR_REF = /\(#(\d+)\)\s*$/;

/**
 * Computes the repo's why-signal score and, as a side effect, fills
 * commit_pr_map with subject-parsed squash-merge references. Runs after the
 * clone and PR fetch are complete.
 */
export async function computeSignal(repoId: number): Promise<SignalScore> {
  const total = await commitCount(repoId);
  const sample = (await logSample(repoId, SAMPLE_LIMIT)).filter(
    (c) => !BOT_AUTHOR.test(c.author),
  );

  // Which PR numbers actually exist for this repo (subject refs can be false
  // positives — issue refs, forks — so we only map refs we can verify).
  const referenced = new Map<string, number>(); // sha -> pr number
  for (const c of sample) {
    const m = SUBJECT_PR_REF.exec(c.subject);
    if (m) referenced.set(c.sha, Number(m[1]));
  }
  const prNumbers = [...new Set(referenced.values())];
  const known = new Set<number>(
    prNumbers.length === 0
      ? []
      : (
          await db()
            .select({ number: schema.pullRequests.number })
            .from(schema.pullRequests)
            .where(
              and(
                eq(schema.pullRequests.repoId, repoId),
                inArray(schema.pullRequests.number, prNumbers),
              ),
            )
        ).map((r) => r.number),
  );

  const rows = [...referenced.entries()]
    .filter(([, n]) => known.has(n))
    .map(([sha, prNumber]) => ({ repoId, sha, prNumber, source: "subject_ref" }));
  for (let i = 0; i < rows.length; i += 1000) {
    await db()
      .insert(schema.commitPrMap)
      .values(rows.slice(i, i + 1000))
      .onConflictDoNothing();
  }

  const [{ value: mapped }] = await db()
    .select({ value: count() })
    .from(schema.commitPrMap)
    .where(eq(schema.commitPrMap.repoId, repoId));

  const descriptive = sample.filter(
    (c) => (c.subject + " " + c.body).trim().split(/\s+/).length >= 20,
  ).length;

  const pctDescriptiveMessages = sample.length ? Math.round((descriptive / sample.length) * 100) : 0;
  const pctCommitsWithPr = sample.length
    ? Math.min(100, Math.round((mapped / Math.min(sample.length, total)) * 100))
    : 0;
  const initialCommitDump = (await rootCommitFileCount(repoId)) > 1000;

  // Weighted blend: PR linkage is the strongest why-signal on GitHub, message
  // quality second; an import-dump origin caps the ceiling because pre-import
  // history is unrecoverable.
  let score = Math.round(0.6 * pctCommitsWithPr + 0.4 * pctDescriptiveMessages);
  if (initialCommitDump) score = Math.min(score, 60);

  return {
    score,
    label: score >= 55 ? "rich" : score >= 25 ? "moderate" : "sparse",
    totalCommits: total,
    sampledCommits: sample.length,
    pctDescriptiveMessages,
    pctCommitsWithPr,
    initialCommitDump,
  };
}
