/**
 * CLI for the full pipeline: region → evidence bundle → gate → narrative.
 *
 *   npx tsx scripts/explain.ts <repoId> <path> <startLine> <endLine>
 *
 * Requires ANTHROPIC_API_KEY for non-gated regions. Gated (insufficient)
 * regions return the literal message with zero LLM calls — testable keyless.
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
  const [repoIdArg, filePath, startArg, endArg] = process.argv.slice(2);
  if (!repoIdArg || !filePath || !startArg || !endArg) {
    console.error("usage: tsx scripts/explain.ts <repoId> <path> <startLine> <endLine>");
    process.exit(2);
  }

  const { buildEvidenceBundle } = await import("../src/server/archaeology");
  const { explainRegion } = await import("../src/server/explain");

  const bundle = await buildEvidenceBundle(
    { repoId: Number(repoIdArg), path: filePath, startLine: Number(startArg), endLine: Number(endArg) },
    process.env.GITHUB_TOKEN ?? "",
  );
  if ("declined" in bundle) {
    console.log(`DECLINED: ${bundle.reason}`);
    process.exit(1);
  }

  const q = bundle.quality;
  console.log(`\n━━ EVIDENCE QUALITY: ${q.label.toUpperCase()} (${q.informativeUnits} informative units) ━━`);
  for (const r of q.reasons) console.log(`   · ${r}`);

  const started = Date.now();
  const result = await explainRegion(bundle);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (result.kind === "insufficient") {
    console.log(`\n━━ RESULT (${result.gated ? "GATED — zero LLM calls, " : "model-declared, "}${elapsed}s) ━━`);
    console.log(`"${result.message}"`);
    console.log(`\nAvailable evidence shown to the user instead of a narrative:`);
    for (const c of bundle.commits) {
      console.log(`   ${c.shortSha} ${c.date.slice(0, 10)} ${c.subject}${c.isIntroduction ? " [introduction]" : ""}`);
    }
    process.exit(0);
  }

  console.log(`\n━━ VERDICT (model=${result.model}, ${elapsed}s, ${result.usage.inputTokens}in/${result.usage.outputTokens}out tokens) ━━`);
  console.log(`${result.verdict.text}`);
  console.log(`   cited: ${result.verdict.citations.map((c) => `${c.type}:${c.ref.slice(0, 10)}`).join(", ")}`);

  if (result.timeline.length > 0) {
    console.log(`\n━━ EVOLUTION ━━`);
    for (const t of result.timeline) {
      console.log(`   [${t.evidence.type}:${t.evidence.ref.slice(0, 10)}] ${t.summary}`);
    }
  }

  console.log(`\n━━ THE STORY, SENTENCE BY SENTENCE ━━`);
  for (const c of result.claims) {
    console.log(`   ${c.kind === "inferred" ? "(inferred) " : ""}${c.text}`);
    console.log(`      cited: ${c.citations.map((x) => `${x.type}:${x.ref.slice(0, 10)}`).join(", ")}`);
  }

  const droppedTotal = result.dropped.claims + result.dropped.timeline;
  console.log(
    `\nvalidator: ${droppedTotal} statement(s) dropped, ${result.dropped.citations} bad citation(s) stripped`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
