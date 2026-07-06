import type { EvidenceBundle } from "@/server/archaeology";
import type { Claim, CitationRef, ModelAnswer, TimelineEntry } from "./schema";

/**
 * The citation validator — the enforcement half of "no claim without a
 * citation, ever". The model's output is *proposed* text; nothing reaches the
 * user until every sentence survives resolution against the evidence bundle.
 *
 * How a sentence lives or dies:
 *
 *   1. Each citation on the sentence is resolved against the bundle:
 *      - commit: ref must be ≥7 hex chars and a prefix-match of exactly one
 *        bundle commit sha (full or short shas both work; an sha the model
 *        invented, or from some other repo, matches nothing and is invalid)
 *      - pr:     ref must parse as a number that is in the bundle's PR set
 *      - issue:  ref must parse as a number in the bundle's issue set
 *   2. Invalid citations are stripped from the sentence.
 *   3. A sentence with ZERO surviving citations is DROPPED — not hedged, not
 *      reworded. It never renders.
 *
 * The same rule applies to the verdict and to timeline entries. Dropping is
 * counted and reported so dishonesty attempts are visible in logs and UI.
 */

export type ValidationOutcome = {
  verdict: Claim | null;
  claims: Claim[];
  timeline: TimelineEntry[];
  dropped: { claims: number; timeline: number; citations: number };
};

export function buildRefSets(bundle: EvidenceBundle) {
  return {
    commitShas: bundle.commits.map((c) => c.sha),
    prNumbers: new Set(bundle.prs.map((p) => p.number)),
    issueNumbers: new Set(bundle.issues.map((i) => i.number)),
  };
}

export function resolveCitation(
  citation: CitationRef,
  refs: ReturnType<typeof buildRefSets>,
): boolean {
  const ref = citation.ref.trim().replace(/^#/, "");
  switch (citation.type) {
    case "commit": {
      if (!/^[0-9a-f]{7,40}$/i.test(ref)) return false;
      const matches = refs.commitShas.filter((sha) => sha.startsWith(ref.toLowerCase()));
      return matches.length === 1;
    }
    case "pr": {
      const n = Number(ref);
      return Number.isInteger(n) && refs.prNumbers.has(n);
    }
    case "issue": {
      const n = Number(ref);
      return Number.isInteger(n) && refs.issueNumbers.has(n);
    }
  }
}

function validateClaim(
  claim: Claim,
  refs: ReturnType<typeof buildRefSets>,
): { claim: Claim | null; strippedCitations: number } {
  const valid = claim.citations.filter((c) => resolveCitation(c, refs));
  const stripped = claim.citations.length - valid.length;
  if (valid.length === 0) return { claim: null, strippedCitations: stripped };
  return { claim: { ...claim, citations: valid }, strippedCitations: stripped };
}

export function validateAnswer(answer: ModelAnswer, bundle: EvidenceBundle): ValidationOutcome {
  const refs = buildRefSets(bundle);
  const dropped = { claims: 0, timeline: 0, citations: 0 };

  const claims: Claim[] = [];
  for (const raw of answer.claims) {
    const { claim, strippedCitations } = validateClaim(raw, refs);
    dropped.citations += strippedCitations;
    if (claim) claims.push(claim);
    else dropped.claims++;
  }

  let verdict: Claim | null = null;
  if (answer.verdict) {
    const { claim, strippedCitations } = validateClaim(answer.verdict, refs);
    dropped.citations += strippedCitations;
    if (claim) verdict = claim;
    else dropped.claims++;
  }

  const timeline: TimelineEntry[] = [];
  for (const entry of answer.timeline) {
    if (resolveCitation(entry.evidence, refs)) timeline.push(entry);
    else dropped.timeline++;
  }

  return { verdict, claims, timeline, dropped };
}
