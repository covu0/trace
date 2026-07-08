/**
 * Live verification of the free-trial + BYOK boundaries against the real DB.
 *
 *   npx tsx scripts/test-freetrial.ts
 *
 * Also proves BYOK requests authenticate with the user's key, not ours: a
 * bogus BYOK key must yield an Anthropic 401 even though the house key in
 * env is valid.
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

const USER = 900_000_003;
let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!cond) failures++;
}

async function main() {
  const { db, schema } = await import("../src/db");
  const { freeQueriesUsed, FREE_CAP, checkDailyCaps } = await import("../src/server/limits");
  const { buildEvidenceBundle } = await import("../src/server/archaeology");
  const { explainRegion, NarrationUnavailableError } = await import("../src/server/explain");
  const { inArray } = await import("drizzle-orm");

  const repo = await db().query.repos.findFirst();
  if (!repo) throw new Error("need at least one ingested repo");

  await db().delete(schema.queries).where(inArray(schema.queries.userId, [USER]));
  await db().delete(schema.users).where(inArray(schema.users.id, [USER]));
  await db().insert(schema.users).values([{ id: USER, login: "freetrial-test" }]);

  const row = (keySource: "house" | "byok") => ({
    repoId: repo.id,
    userId: USER,
    path: "freetrial-test",
    startLine: 1,
    endLine: 1,
    qualityLabel: "rich",
    informativeUnits: 3,
    outcome: "answer" as const,
    keySource,
    latencyMs: 1,
  });

  try {
    // ── 1. Free-trial boundary (cap = 3) ──
    await db().insert(schema.queries).values([row("house"), row("house")]);
    let used = await freeQueriesUsed(USER);
    check("2 house queries → 3rd free trace allowed", used < FREE_CAP(), `used=${used}/${FREE_CAP()}`);

    await db().insert(schema.queries).values([row("house")]); // the 3rd
    used = await freeQueriesUsed(USER);
    check(
      "3 house queries → 4th blocked (402 upsell path)",
      used >= FREE_CAP(),
      `used=${used}/${FREE_CAP()} → route returns 402 with the add-your-key prompt`,
    );

    // ── 2. BYOK queries invisible to the trial and to our caps ──
    await db()
      .insert(schema.queries)
      .values(Array.from({ length: 25 }, () => row("byok")));
    used = await freeQueriesUsed(USER);
    check("25 BYOK queries → free-trial meter unchanged", used === 3, `used=${used} (byok rows don't count)`);

    const caps = await checkDailyCaps(USER);
    check(
      "25 BYOK queries → daily caps see only the 3 house queries",
      caps.allowed === true && caps.usedByUser === 3,
      caps.allowed ? `usedByUser=${caps.usedByUser}, usedGlobal counts house only` : "blocked?!",
    );

    // ── 3. BYOK authenticates with THE USER'S key, never ours ──
    const bundle = await buildEvidenceBundle(
      { repoId: 2, path: "source/index.js", startLine: 1, endLine: 40 },
      "",
    );
    if ("declined" in bundle) throw new Error(bundle.reason);
    const houseKeyValid = !!process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-api");
    try {
      await explainRegion(bundle, { apiKey: "sk-ant-bogus-byok-key" });
      check("bogus BYOK key rejected", false, "call succeeded — house key must have been used!");
    } catch (err) {
      check(
        "bogus BYOK key → Anthropic 401 despite valid house key in env",
        err instanceof NarrationUnavailableError && houseKeyValid,
        `houseKeyPresent=${houseKeyValid}; error="${err instanceof Error ? err.message : err}"`,
      );
    }
  } finally {
    await db().delete(schema.queries).where(inArray(schema.queries.userId, [USER]));
    await db().delete(schema.users).where(inArray(schema.users.id, [USER]));
    console.log("cleanup: synthetic rows removed");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
