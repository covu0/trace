import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { GitHubError, listMergedPrsPage } from "./github";
import { bareClone, headSha } from "./gitrepo";
import { computeSignal } from "./signal";

// In-process job registry. If the container restarts mid-ingest, the DB row
// keeps its checkpoints (cloned, pr_pages_fetched) and status; the next
// authenticated status poll calls ensureRunning() and the job resumes using
// that user's token. Tokens live only in memory, never at rest.
const running = new Set<number>();
const perUser = new Map<number, number>();
const MAX_CONCURRENT_PER_USER = 2;

export function isRunning(repoId: number) {
  return running.has(repoId);
}

export function ensureRunning(repo: typeof schema.repos.$inferSelect, token: string, userId: number) {
  const active = ["queued", "cloning", "fetching_prs", "scoring"].includes(repo.status);
  if (!active || running.has(repo.id)) return;
  if ((perUser.get(userId) ?? 0) >= MAX_CONCURRENT_PER_USER) return;

  running.add(repo.id);
  perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
  void runIngest(repo.id, token)
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      await db()
        .update(schema.repos)
        .set({ status: "failed", error: message, updatedAt: new Date() })
        .where(eq(schema.repos.id, repo.id));
    })
    .finally(() => {
      running.delete(repo.id);
      const n = (perUser.get(userId) ?? 1) - 1;
      if (n <= 0) perUser.delete(userId);
      else perUser.set(userId, n);
    });
}

async function setStatus(repoId: number, patch: Partial<typeof schema.repos.$inferInsert>) {
  await db()
    .update(schema.repos)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.repos.id, repoId));
}

/** The full ingest sequence. Exported for the CLI harness; the web layer goes through ensureRunning. */
export async function runIngest(repoId: number, token: string) {
  const repo = await db().query.repos.findFirst({ where: eq(schema.repos.id, repoId) });
  if (!repo) return;

  if (!repo.cloned) {
    await setStatus(repoId, { status: "cloning", error: null });
    await bareClone(repoId, repo.owner, repo.name, repo.defaultBranch);
    await setStatus(repoId, { cloned: 1, headSha: await headSha(repoId) });
  }

  await setStatus(repoId, { status: "fetching_prs" });
  let page = repo.prPagesFetched;
  let done = false;
  while (!done) {
    page += 1;
    let result;
    try {
      result = await listMergedPrsPage(token, repo.owner, repo.name, page);
    } catch (err) {
      // Rate limit: park the job resumable at the current checkpoint instead
      // of failing. The next status poll after reset picks it back up.
      if (err instanceof GitHubError && err.status === 429) {
        await setStatus(repoId, { error: err.message });
        return;
      }
      throw err;
    }
    done = result.done;
    if (result.prs.length > 0) {
      await db()
        .insert(schema.pullRequests)
        .values(
          result.prs.map((p) => ({
            repoId,
            number: p.number,
            title: p.title,
            body: p.body,
            author: p.author,
            mergedAt: new Date(p.mergedAt),
            mergeCommitSha: p.mergeCommitSha,
            headSha: p.headSha,
          })),
        )
        .onConflictDoNothing();
      const mappings = result.prs
        .filter((p) => p.mergeCommitSha)
        .map((p) => ({
          repoId,
          sha: p.mergeCommitSha as string,
          prNumber: p.number,
          source: "merge_commit",
        }));
      if (mappings.length > 0) {
        await db().insert(schema.commitPrMap).values(mappings).onConflictDoNothing();
      }
    }
    const fetched = (await db().$count(schema.pullRequests, eq(schema.pullRequests.repoId, repoId)));
    await setStatus(repoId, { prPagesFetched: page, prCount: fetched, error: null });
  }

  await setStatus(repoId, { status: "scoring" });
  const signal = await computeSignal(repoId);
  await setStatus(repoId, { status: "ready", signal });
}
