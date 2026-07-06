/**
 * Verifies the narration fail-safe: with a broken Anthropic credential (the
 * same APIError pathway as exhausted credit), explainRegion must throw the
 * typed, user-safe NarrationUnavailableError — no crash, no paid retries.
 *
 *   $env:ANTHROPIC_API_KEY="sk-ant-bogus"; npx tsx scripts/test-failsafe.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

try {
  const env = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = /^([^=#\s]+)=(.*)$/.exec(line.trim());
    // Existing process env wins — that's how the bogus key overrides .env.local.
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* ambient env */
}

async function main() {
  const { buildEvidenceBundle } = await import("../src/server/archaeology");
  const { explainRegion, NarrationUnavailableError } = await import("../src/server/explain");

  const bundle = await buildEvidenceBundle(
    { repoId: 2, path: "source/index.js", startLine: 1, endLine: 40 },
    "",
  );
  if ("declined" in bundle) throw new Error(bundle.reason);
  console.log(`bundle ready (quality=${bundle.quality.label}); calling narration with broken credential…`);

  const started = Date.now();
  try {
    await explainRegion(bundle);
    console.log("FAIL — narration succeeded with a bogus key?!");
    process.exit(1);
  } catch (err) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (err instanceof NarrationUnavailableError) {
      console.log(`PASS  typed fail-safe error in ${elapsed}s (no retry storm)`);
      console.log(`PASS  user-safe message: "${err.message}"`);
      process.exit(0);
    }
    console.log(`FAIL  unexpected error type: ${err instanceof Error ? err.name + ": " + err.message : err}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
