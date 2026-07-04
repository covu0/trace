import {
  bigint,
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
