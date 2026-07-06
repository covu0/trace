/**
 * CLI ingest harness — same code path as the web flow, for engine testing.
 *
 *   npx tsx scripts/ingest.ts <owner>/<repo>
 *
 * Reads .env.local; GITHUB_TOKEN optional (unauthenticated = 60 req/hr).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

try {
  const env = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = /^([^=#\s]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* rely on ambient env */
}

async function main() {
  const slug = process.argv[2];
  const m = /^([\w-]+)\/([\w.-]+)$/.exec(slug ?? "");
  if (!m) {
    console.error("usage: tsx scripts/ingest.ts <owner>/<repo>");
    process.exit(2);
  }
  const [, owner, name] = m;
  const token = process.env.GITHUB_TOKEN ?? "";

  const { db, schema } = await import("../src/db");
  const { getRepo } = await import("../src/server/github");
  const { runIngest } = await import("../src/server/ingest");
  const { eq, and } = await import("drizzle-orm");

  const info = await getRepo(token, owner, name);
  if (info.private) throw new Error("private repo");
  if (info.sizeKb > 150 * 1024) throw new Error(`too large: ${info.sizeKb} KB`);

  const existing = await db().query.repos.findFirst({
    where: and(eq(schema.repos.owner, info.owner), eq(schema.repos.name, info.name)),
  });
  let repoId: number;
  if (existing) {
    repoId = existing.id;
    console.log(`repo exists (id=${repoId}, status=${existing.status})`);
  } else {
    const anyUser = await db().query.users.findFirst();
    if (!anyUser) throw new Error("no user row to attribute the repo to — sign in once first");
    const [row] = await db()
      .insert(schema.repos)
      .values({
        owner: info.owner,
        name: info.name,
        defaultBranch: info.defaultBranch,
        sizeKb: info.sizeKb,
        addedBy: anyUser.id,
      })
      .returning();
    repoId = row.id;
    console.log(`repo created (id=${repoId}, ${info.sizeKb} KB, branch=${info.defaultBranch})`);
  }

  const started = Date.now();
  await runIngest(repoId, token);
  const repo = await db().query.repos.findFirst({ where: eq(schema.repos.id, repoId) });
  console.log(
    `status=${repo?.status} prs=${repo?.prCount} signal=${JSON.stringify(repo?.signal)} in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  process.exit(repo?.status === "ready" ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
