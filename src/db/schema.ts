import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  // GitHub's numeric user id — stable across login renames.
  id: bigint("id", { mode: "number" }).primaryKey(),
  login: text("login").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RepoStatus =
  | "queued"
  | "cloning"
  | "fetching_prs"
  | "scoring"
  | "ready"
  | "failed";

export type SignalScore = {
  score: number; // 0–100
  label: "rich" | "moderate" | "sparse";
  totalCommits: number;
  sampledCommits: number;
  pctDescriptiveMessages: number;
  pctCommitsWithPr: number;
  initialCommitDump: boolean;
};

export const repos = pgTable(
  "repos",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    headSha: text("head_sha"),
    sizeKb: integer("size_kb").notNull(),
    status: text("status").$type<RepoStatus>().notNull().default("queued"),
    // Resumable-ingest checkpoints. A restarted server picks up from these.
    cloned: integer("cloned").notNull().default(0), // 0/1
    prPagesFetched: integer("pr_pages_fetched").notNull().default(0),
    prCount: integer("pr_count").notNull().default(0),
    signal: jsonb("signal").$type<SignalScore>(),
    error: text("error"),
    addedBy: bigint("added_by", { mode: "number" })
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("repos_owner_name_idx").on(t.owner, t.name)],
);

export const pullRequests = pgTable(
  "pull_requests",
  {
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    // Bodies can be large; they are the why-signal, so we keep them whole.
    body: text("body"),
    author: text("author"),
    mergedAt: timestamp("merged_at"),
    mergeCommitSha: text("merge_commit_sha"),
    headSha: text("head_sha"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number] })],
);

export type QueryOutcome = "answer" | "insufficient_gated" | "insufficient_model";

// One row per completed why-query — the instrumentation that replaces the
// pre-build eval set (founder decision): region, tier, cost, latency, drops.
export const queries = pgTable(
  "queries",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    path: text("path").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    qualityLabel: text("quality_label").notNull(),
    informativeUnits: integer("informative_units").notNull(),
    outcome: text("outcome").$type<QueryOutcome>().notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: doublePrecision("cost_usd"),
    latencyMs: integer("latency_ms").notNull(),
    droppedClaims: integer("dropped_claims").notNull().default(0),
    droppedTimeline: integer("dropped_timeline").notNull().default(0),
    droppedCitations: integer("dropped_citations").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("queries_user_created_idx").on(t.userId, t.createdAt)],
);

// One rating per query (the query is already per-user). This corpus is what
// lets us A/B models on truthfulness instead of eyeballing narratives.
export const feedback = pgTable("feedback", {
  queryId: integer("query_id")
    .primaryKey()
    .references(() => queries.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1 = up, -1 = down
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Issues are fetched lazily at query time (ingesting all of them up front
// would waste rate limit on issues nobody asks about) and cached here.
export const issuesCache = pgTable(
  "issues_cache",
  {
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    // GitHub issues and PRs share a number space; refs can point at either.
    isPull: integer("is_pull").notNull().default(0),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number] })],
);

export const commitPrMap = pgTable(
  "commit_pr_map",
  {
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    prNumber: integer("pr_number").notNull(),
    // "merge_commit" (from PR API) or "subject_ref" (parsed "(#N)" squash suffix)
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.sha] })],
);
