/**
 * Demonstrates the citation validator on a REAL evidence bundle with a
 * SYNTHETIC model answer containing deliberate fabrications — exactly what a
 * hallucinating model would produce. Shows which sentences live and why.
 *
 *   npx tsx scripts/validator-demo.ts <repoId> <path> <startLine> <endLine>
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
  const { buildEvidenceBundle } = await import("../src/server/archaeology");
  const { validateAnswer } = await import("../src/server/explain/validate");

  const bundle = await buildEvidenceBundle(
    { repoId: Number(repoIdArg), path: filePath, startLine: Number(startArg), endLine: Number(endArg) },
    process.env.GITHUB_TOKEN ?? "",
  );
  if ("declined" in bundle) throw new Error(bundle.reason);

  const realSha = bundle.commits[0].sha;
  const realPr = bundle.prs[0]?.number ?? 0;

  // A synthetic "model answer": two honest sentences, three fabrications.
  const synthetic = {
    insufficient_evidence: false,
    verdict: {
      text: "This region exists because of real, documented changes.",
      kind: "explicit" as const,
      citations: [{ type: "pr" as const, ref: String(realPr) }],
    },
    claims: [
      {
        text: `KEPT: cites a commit that is actually in the bundle (${realSha.slice(0, 7)}).`,
        kind: "explicit" as const,
        citations: [{ type: "commit" as const, ref: realSha.slice(0, 10) }],
      },
      {
        text: "DROPPED: cites a PR number that does not exist in the bundle — a classic hallucinated reference.",
        kind: "explicit" as const,
        citations: [{ type: "pr" as const, ref: "9999" }],
      },
      {
        text: "DROPPED: cites a plausible-looking but invented commit sha.",
        kind: "inferred" as const,
        citations: [{ type: "commit" as const, ref: "deadbeefca" }],
      },
      {
        text: "DROPPED: has no citations at all — an unsupported assertion.",
        kind: "inferred" as const,
        citations: [],
      },
      {
        text: "KEPT (with a stripped citation): one real commit citation survives, one fake issue citation is removed.",
        kind: "explicit" as const,
        citations: [
          { type: "commit" as const, ref: realSha.slice(0, 10) },
          { type: "issue" as const, ref: "424242" },
        ],
      },
    ],
    timeline: [
      { evidence: { type: "commit" as const, ref: realSha.slice(0, 10) }, summary: "KEPT: real commit." },
      { evidence: { type: "pr" as const, ref: "31337" }, summary: "DROPPED: fabricated PR." },
    ],
  };

  console.log(`bundle: ${bundle.repo.owner}/${bundle.repo.name} ${bundle.region.path}:${bundle.region.startLine}-${bundle.region.endLine}`);
  console.log(`valid refs: ${bundle.commits.length} commits, PRs {${bundle.prs.map((p) => p.number).join(", ")}}, issues {${bundle.issues.map((i) => i.number).join(", ")}}`);
  console.log(`\nmodel proposed: 1 verdict + ${synthetic.claims.length} claims + ${synthetic.timeline.length} timeline entries`);

  const out = validateAnswer(synthetic, bundle);

  console.log(`\nAFTER VALIDATION:`);
  console.log(`verdict: ${out.verdict ? `KEPT — "${out.verdict.text}"` : "DROPPED"}`);
  for (const c of out.claims) {
    console.log(`claim KEPT: "${c.text}"  [${c.citations.map((x) => `${x.type}:${x.ref.slice(0, 10)}`).join(", ")}]`);
  }
  for (const t of out.timeline) console.log(`timeline KEPT: "${t.summary}"`);
  console.log(
    `\ndropped: ${out.dropped.claims} claim(s), ${out.dropped.timeline} timeline entr(ies); ${out.dropped.citations} citation(s) stripped from surviving sentences`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
