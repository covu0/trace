import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { collectRegionCommits, type RegionInput } from "./region";
import { enrich } from "./enrich";
import { rateEvidence } from "./quality";
import type { DeclinedRegion, EvidenceBundle } from "./types";

export type { EvidenceBundle, DeclinedRegion } from "./types";

/**
 * The archaeology engine's front door: region → evidence bundle.
 * Pure with respect to the web layer — callable from API routes, the CLI
 * harness, and tests identically. `token` may be empty (unauthenticated
 * issue fetches, 60/hr — fine for the CLI).
 */
export async function buildEvidenceBundle(
  input: RegionInput,
  token: string,
): Promise<EvidenceBundle | DeclinedRegion> {
  const repo = await db().query.repos.findFirst({ where: eq(schema.repos.id, input.repoId) });
  if (!repo || repo.status !== "ready") {
    return { declined: true, reason: "Repository is not ingested yet." };
  }

  const collected = await collectRegionCommits(input, { owner: repo.owner, name: repo.name });
  if ("declined" in collected) return collected;

  const { prs, issues } = await enrich(
    { id: repo.id, owner: repo.owner, name: repo.name },
    collected.commits,
    token,
  );

  return {
    repo: { id: repo.id, owner: repo.owner, name: repo.name, headSha: repo.headSha },
    region: { path: input.path, startLine: input.startLine, endLine: input.endLine },
    commits: collected.commits,
    prs,
    issues,
    truncatedHistory: collected.truncated,
    quality: rateEvidence(collected.commits, prs, issues),
  };
}
