/**
 * The evidence bundle is the archaeology engine's only output and the
 * explanation pipeline's only input. Every claim Trace ever shows a user must
 * cite an item from one of these arrays — the citation validator (Milestone 3)
 * resolves refs against exactly this structure.
 */

export type EvidenceCommit = {
  sha: string;
  shortSha: string;
  author: string;
  date: string; // ISO 8601
  subject: string;
  body: string;
  /** Truncated unified diff hunks for the queried region at this commit. */
  patch: string;
  /** Oldest commit in the region's history — where the code first appeared. */
  isIntroduction: boolean;
  isBot: boolean;
  /** PR that introduced this commit, when a mapping exists. */
  prNumber: number | null;
  url: string;
};

export type EvidencePr = {
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  mergedAt: string | null;
  url: string;
};

export type EvidenceIssue = {
  number: number;
  title: string;
  body: string | null;
  url: string;
};

export type EvidenceQualityLabel = "rich" | "partial" | "poor";

export type EvidenceQuality = {
  label: EvidenceQualityLabel;
  /**
   * Hard gate for the answer pipeline: when true, Trace answers with the
   * literal "Not enough evidence to answer confidently" and renders only the
   * raw evidence — no generated narrative. Never overridden by the LLM.
   */
  insufficient: boolean;
  /** Count of informative evidence units (see quality.ts for the definition). */
  informativeUnits: number;
  stats: {
    commits: number;
    botCommits: number;
    commitsWithPr: number;
    descriptiveMessages: number;
    prsWithBody: number;
    issues: number;
  };
  /** Human-readable, stat-backed reasons shown verbatim in the UI. */
  reasons: string[];
};

export type EvidenceBundle = {
  repo: { id: number; owner: string; name: string; headSha: string | null };
  region: { path: string; startLine: number; endLine: number };
  commits: EvidenceCommit[];
  prs: EvidencePr[];
  issues: EvidenceIssue[];
  /** True when history was capped (introduction + most recent N kept). */
  truncatedHistory: boolean;
  quality: EvidenceQuality;
};

/** Result of a region query that we decline to analyze, with the reason. */
export type DeclinedRegion = {
  declined: true;
  reason: string;
};

export const MAX_REGION_LINES = 400;
export const MAX_EVIDENCE_COMMITS = 25; // introduction + 24 most recent
export const MAX_PATCH_CHARS = 4000;
export const MAX_ISSUES_PER_QUERY = 8;
