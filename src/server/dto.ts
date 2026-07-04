import type { schema } from "@/db";

/** The repo shape exposed to the browser — no internal checkpoints beyond progress. */
export function publicRepo(r: typeof schema.repos.$inferSelect) {
  return {
    id: r.id,
    owner: r.owner,
    name: r.name,
    defaultBranch: r.defaultBranch,
    status: r.status,
    prCount: r.prCount,
    prPagesFetched: r.prPagesFetched,
    signal: r.signal,
    error: r.error,
    createdAt: r.createdAt,
  };
}

export type PublicRepo = ReturnType<typeof publicRepo>;
