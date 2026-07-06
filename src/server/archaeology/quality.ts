import type { EvidenceCommit, EvidenceIssue, EvidencePr, EvidenceQuality } from "./types";

const DESCRIPTIVE_WORDS = 20;
const BODY_WORDS = 15;

function words(s: string): number {
  return s.trim() === "" ? 0 : s.trim().split(/\s+/).length;
}

/**
 * Deterministic evidence-quality rating. This — not the LLM — decides whether
 * Trace is allowed to narrate at all:
 *
 *   informative unit = a descriptive commit message, a PR with a substantive
 *   body, or a linked issue. These are the places intent gets written down.
 *
 *   rich    ≥ 3 informative units  → full narrative allowed
 *   partial 1–2                    → narrative allowed, hedged, gaps stated
 *   poor    0                      → NO narrative; insufficient-evidence path
 *
 * The thresholds are deliberately simple and auditable; tune them against
 * feedback data, not intuition.
 */
export function rateEvidence(
  commits: EvidenceCommit[],
  prs: EvidencePr[],
  issues: EvidenceIssue[],
): EvidenceQuality {
  const human = commits.filter((c) => !c.isBot);
  const descriptive = human.filter((c) => words(c.subject + " " + c.body) >= DESCRIPTIVE_WORDS);
  const withPr = human.filter((c) => c.prNumber !== null);
  const prsWithBody = prs.filter((p) => words(p.body ?? "") >= BODY_WORDS);

  const informativeUnits = descriptive.length + prsWithBody.length + issues.length;
  const label = informativeUnits >= 3 ? "rich" : informativeUnits >= 1 ? "partial" : "poor";

  const reasons: string[] = [];
  reasons.push(
    `${human.length} human commit${human.length === 1 ? "" : "s"} touch this region` +
      (commits.length > human.length ? ` (${commits.length - human.length} bot commits filtered)` : ""),
  );
  reasons.push(
    withPr.length > 0
      ? `${withPr.length} of ${human.length} commits are traceable to a pull request`
      : "no commits are traceable to a pull request",
  );
  reasons.push(
    prsWithBody.length > 0
      ? `${prsWithBody.length} PR description${prsWithBody.length === 1 ? "" : "s"} with substance`
      : prs.length > 0
        ? "linked PRs exist but their descriptions are empty or trivial"
        : "no linked pull requests found",
  );
  reasons.push(
    descriptive.length > 0
      ? `${descriptive.length} commit message${descriptive.length === 1 ? "" : "s"} are descriptive`
      : "commit messages are terse",
  );
  if (issues.length > 0) {
    reasons.push(`${issues.length} linked issue${issues.length === 1 ? "" : "s"} found`);
  }

  return {
    label,
    insufficient: informativeUnits === 0,
    informativeUnits,
    stats: {
      commits: commits.length,
      botCommits: commits.length - human.length,
      commitsWithPr: withPr.length,
      descriptiveMessages: descriptive.length,
      prsWithBody: prsWithBody.length,
      issues: issues.length,
    },
    reasons,
  };
}
