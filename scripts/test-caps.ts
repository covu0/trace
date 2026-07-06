/**
 * Live verification of the spend-protection layers against the real database.
 * Seeds synthetic users + query rows, checks cap decisions at the exact
 * boundaries, and cleans up after itself.
 *
 *   npx tsx scripts/test-caps.ts
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
  /* ambient env */
}

const USER_A = 900_000_001; // will hit the per-user cap
const USER_B = 900_000_002; // gated-only queries, then global-cap victim

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!cond) failures++;
}

async function main() {
  const { db, schema } = await import("../src/db");
  const { checkDailyCaps } = await import("../src/server/limits");
  const { eq, inArray } = await import("drizzle-orm");

  const repo = await db().query.repos.findFirst();
  if (!repo) throw new Error("need at least one ingested repo");

  // Clean slate for the synthetic users, then create them.
  await db().delete(schema.queries).where(inArray(schema.queries.userId, [USER_A, USER_B]));
  await db().delete(schema.users).where(inArray(schema.users.id, [USER_A, USER_B]));
  await db()
    .insert(schema.users)
    .values([
      { id: USER_A, login: "cap-test-a" },
      { id: USER_B, login: "cap-test-b" },
    ]);

  const row = (userId: number, outcome: "answer" | "insufficient_gated") => ({
    repoId: repo.id,
    userId,
    path: "cap-test",
    startLine: 1,
    endLine: 1,
    qualityLabel: "rich",
    informativeUnits: 3,
    outcome,
    latencyMs: 1,
  });

  try {
    // ── 1. Per-user cap boundary (default 50) ──
    await db().insert(schema.queries).values(Array.from({ length: 49 }, () => row(USER_A, "answer")));
    let r = await checkDailyCaps(USER_A);
    check("49 LLM queries → 50th allowed", r.allowed === true, `used=${r.allowed ? r.usedByUser : "?"}/50`);

    await db().insert(schema.queries).values([row(USER_A, "answer")]); // the 50th
    r = await checkDailyCaps(USER_A);
    check(
      "50 LLM queries → 51st blocked (HTTP 429)",
      r.allowed === false && r.status === 429,
      r.allowed === false ? `"${r.error}"` : "was allowed!",
    );

    // ── 2. Gated queries don't count ──
    await db()
      .insert(schema.queries)
      .values(Array.from({ length: 50 }, () => row(USER_B, "insufficient_gated")));
    r = await checkDailyCaps(USER_B);
    check(
      "50 gated (zero-token) queries → still allowed",
      r.allowed === true,
      r.allowed ? `usedByUser=${r.usedByUser} (gated rows invisible to the cap)` : "was blocked!",
    );

    // ── 3. Global cap (set to 60 for this test; user A holds 50 already) ──
    process.env.TRACE_GLOBAL_DAILY_QUERY_CAP = "60";
    await db().insert(schema.queries).values(Array.from({ length: 10 }, () => row(USER_B, "answer")));
    r = await checkDailyCaps(USER_B);
    check(
      "global 60 reached (50+10) → user B blocked at personal 10/50",
      r.allowed === false && r.status === 429,
      r.allowed === false ? `"${r.error}"` : "was allowed!",
    );
  } finally {
    // NOTE: today's real queries by real users also count toward the global
    // total in these checks — synthetic rows dominate, and we clean them up:
    await db().delete(schema.queries).where(inArray(schema.queries.userId, [USER_A, USER_B]));
    await db().delete(schema.users).where(inArray(schema.users.id, [USER_A, USER_B]));
    const [remaining] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, USER_A));
    console.log(`cleanup: synthetic rows removed (${remaining ? "FAILED" : "verified"})`);
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
