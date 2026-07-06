import { fileExistsAtHead, isSafeRepoPath, regionLog } from "@/server/gitrepo";
import type { DeclinedRegion, EvidenceCommit } from "./types";
import { MAX_EVIDENCE_COMMITS, MAX_PATCH_CHARS, MAX_REGION_LINES } from "./types";

const BOT_AUTHOR = /(\[bot\]|dependabot|renovate|github-actions|greenkeeper)/i;

// Files whose "why" doesn't live in their own history — the honest answer is
// to point at the generator/upstream, not to narrate mechanical churn.
const GENERATED_OR_VENDORED: Array<{ test: (p: string) => boolean; reason: string }> = [
  {
    test: (p) => /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|Gemfile\.lock|go\.sum)$/.test(p),
    reason: "Lockfiles are generated — their history is mechanical dependency churn.",
  },
  {
    test: (p) => /(^|\/)(vendor|node_modules|third_party)\//.test(p),
    reason: "Vendored code — its why lives in the upstream project, not this repo's history.",
  },
  {
    test: (p) => /\.(min\.js|min\.css|map|snap|lock)$/.test(p) || /(_pb2?\.(go|py|js|ts)|\.pb\.(go|cc|h)|\.generated\.)/.test(p),
    reason: "Generated file — the why lives in its source/generator, not in this file's diffs.",
  },
  {
    test: (p) => /(^|\/)(dist|build|out|\.next)\//.test(p),
    reason: "Build output — analyze the source files instead.",
  },
];

export type RegionInput = {
  repoId: number;
  path: string;
  startLine: number;
  endLine: number;
};

export function validateRegion(input: RegionInput): DeclinedRegion | null {
  const { path, startLine, endLine } = input;
  if (!isSafeRepoPath(path)) return { declined: true, reason: "Invalid file path." };
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    return { declined: true, reason: "Invalid line range." };
  }
  if (endLine - startLine + 1 > MAX_REGION_LINES) {
    return {
      declined: true,
      reason: `Region too large — select at most ${MAX_REGION_LINES} lines.`,
    };
  }
  const generated = GENERATED_OR_VENDORED.find((g) => g.test(path));
  if (generated) return { declined: true, reason: generated.reason };
  return null;
}

/**
 * Region history from git, shaped into evidence commits: bots marked,
 * patches truncated, history capped to introduction + most recent N.
 */
export async function collectRegionCommits(
  input: RegionInput,
  repoSlug: { owner: string; name: string },
): Promise<{ commits: EvidenceCommit[]; truncated: boolean } | DeclinedRegion> {
  const declined = validateRegion(input);
  if (declined) return declined;

  if (!(await fileExistsAtHead(input.repoId, input.path))) {
    return { declined: true, reason: "File not found at the analyzed commit." };
  }

  const raw = await regionLog(input.repoId, input.path, input.startLine, input.endLine);
  if (raw.length === 0) {
    return { declined: true, reason: "No history found for this region." };
  }

  // git log -L returns newest→oldest; the last entry is the introduction.
  const all: EvidenceCommit[] = raw.map((c, i) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 10),
    author: c.author,
    date: c.date,
    subject: c.subject,
    body: c.body,
    patch:
      c.patch.length > MAX_PATCH_CHARS
        ? c.patch.slice(0, MAX_PATCH_CHARS) + "\n[patch truncated]"
        : c.patch,
    isIntroduction: i === raw.length - 1,
    isBot: BOT_AUTHOR.test(c.author),
    prNumber: null, // filled by enrichment
    url: `https://github.com/${repoSlug.owner}/${repoSlug.name}/commit/${c.sha}`,
  }));

  // Bots are noise unless they introduced the code.
  const meaningful = all.filter((c) => !c.isBot || c.isIntroduction);

  if (meaningful.length <= MAX_EVIDENCE_COMMITS) {
    return { commits: meaningful, truncated: meaningful.length < all.length };
  }
  // Keep the newest N-1 plus the introduction: origin and recency carry the
  // why; mid-history is the first thing we sacrifice to stay reasoning-sized.
  const introduction = meaningful[meaningful.length - 1];
  const recent = meaningful.slice(0, MAX_EVIDENCE_COMMITS - 1);
  return { commits: [...recent, introduction], truncated: true };
}
