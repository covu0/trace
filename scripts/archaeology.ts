/**
 * CLI harness for the archaeology engine — exercises the exact code path the
 * API will use, with zero web dependencies.
 *
 *   npx tsx scripts/archaeology.ts <repoId> <path> <startLine> <endLine> [--json]
 *
 * Reads .env.local for DATABASE_URL; GITHUB_TOKEN optional (issue fetches run
 * unauthenticated without it).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

// Minimal .env.local loader — the CLI runs outside Next.js.
try {
  const env = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = /^([^=#\s]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env.local — rely on ambient env */
}

async function main() {
  const [repoIdArg, filePath, startArg, endArg] = process.argv.slice(2);
  const asJson = process.argv.includes("--json");
  if (!repoIdArg || !filePath || !startArg || !endArg) {
    console.error("usage: tsx scripts/archaeology.ts <repoId> <path> <startLine> <endLine> [--json]");
    process.exit(2);
  }

  const { buildEvidenceBundle } = await import("../src/server/archaeology");
  const bundle = await buildEvidenceBundle(
    {
      repoId: Number(repoIdArg),
      path: filePath,
      startLine: Number(startArg),
      endLine: Number(endArg),
    },
    process.env.GITHUB_TOKEN ?? "",
  );

  if (asJson) {
    console.log(JSON.stringify(bundle, null, 2));
    process.exit(0);
  }

  if ("declined" in bundle) {
    console.log(`DECLINED: ${bundle.reason}`);
    process.exit(1);
  }

  const q = bundle.quality;
  console.log(`\n${bundle.repo.owner}/${bundle.repo.name} — ${bundle.region.path}:${bundle.region.startLine}-${bundle.region.endLine}`);
  console.log(`evidence quality: ${q.label.toUpperCase()} (${q.informativeUnits} informative units)${q.insufficient ? "  ⚠ INSUFFICIENT — no narrative would be generated" : ""}`);
  for (const r of q.reasons) console.log(`  · ${r}`);

  console.log(`\ncommits (${bundle.commits.length}${bundle.truncatedHistory ? ", history truncated" : ""}):`);
  for (const c of bundle.commits) {
    const tags = [
      c.isIntroduction ? "INTRODUCTION" : null,
      c.isBot ? "bot" : null,
      c.prNumber !== null ? `PR #${c.prNumber}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${c.shortSha}  ${c.date.slice(0, 10)}  ${c.subject.slice(0, 80)}${tags ? `  [${tags}]` : ""}`);
  }

  if (bundle.prs.length > 0) {
    console.log(`\npull requests (${bundle.prs.length}):`);
    for (const p of bundle.prs) {
      const bodyWords = (p.body ?? "").trim().split(/\s+/).filter(Boolean).length;
      console.log(`  #${p.number}  ${p.title.slice(0, 70)}  (body: ${bodyWords} words)`);
    }
  }
  if (bundle.issues.length > 0) {
    console.log(`\nissues (${bundle.issues.length}):`);
    for (const i of bundle.issues) console.log(`  #${i.number}  ${i.title.slice(0, 70)}`);
  }
  console.log();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
