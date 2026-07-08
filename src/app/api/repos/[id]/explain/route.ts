import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { buildEvidenceBundle, type EvidenceBundle } from "@/server/archaeology";
import {
  costUsd,
  explainRegion,
  INSUFFICIENT_MESSAGE,
  NarrationUnavailableError,
} from "@/server/explain";
import { checkDailyCaps, FREE_CAP, freeQueriesUsed } from "@/server/limits";

const Body = z.object({
  path: z.string().min(1).max(500),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  // Two-phase flow so the UI can show honest progress:
  //   "evidence" — build the bundle, return quality + counts fast (~1-2s);
  //               insufficient regions terminate here (gate, zero LLM).
  //   "answer"  — rebuild the bundle and run the narrative pipeline.
  phase: z.enum(["evidence", "answer"]),
});

function slimEvidence(bundle: EvidenceBundle) {
  return {
    commits: bundle.commits.map((c) => ({
      sha: c.sha,
      shortSha: c.shortSha,
      subject: c.subject,
      date: c.date,
      url: c.url,
      prNumber: c.prNumber,
      isIntroduction: c.isIntroduction,
    })),
    prs: bundle.prs.map((p) => ({ number: p.number, title: p.title, url: p.url })),
    issues: bundle.issues.map((i) => ({ number: i.number, title: i.title, url: i.url })),
  };
}

async function logQuery(row: typeof schema.queries.$inferInsert): Promise<number> {
  const [r] = await db().insert(schema.queries).values(row).returning({ id: schema.queries.id });
  return r.id;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide path, startLine, endLine and phase" }, { status: 400 });
  }
  const { phase, ...region } = parsed.data;

  const started = Date.now();
  const bundle = await buildEvidenceBundle({ repoId: id, ...region }, session.accessToken);
  if ("declined" in bundle) {
    return NextResponse.json({ error: bundle.reason }, { status: 400 });
  }

  const base = {
    repoId: id,
    userId: session.githubId,
    path: region.path,
    startLine: region.startLine,
    endLine: region.endLine,
    qualityLabel: bundle.quality.label,
    informativeUnits: bundle.quality.informativeUnits,
  };

  // The gate ends the query in either phase — insufficient never reaches the model.
  if (bundle.quality.insufficient) {
    const queryId = await logQuery({
      ...base,
      outcome: "insufficient_gated",
      latencyMs: Date.now() - started,
    });
    return NextResponse.json({
      phase,
      quality: bundle.quality,
      evidence: slimEvidence(bundle),
      result: { kind: "insufficient", message: INSUFFICIENT_MESSAGE, gated: true },
      queryId,
    });
  }

  if (phase === "evidence") {
    return NextResponse.json({
      phase,
      quality: bundle.quality,
      counts: {
        commits: bundle.commits.length,
        prs: bundle.prs.length,
        issues: bundle.issues.length,
      },
    });
  }

  // phase === "answer". BYOK (user's own Anthropic key, sent per-request from
  // their browser, never stored or logged here) bypasses the free trial and
  // our caps — their spend, their limits. House-key queries walk the gates.
  const byokKey = req.headers.get("x-anthropic-key")?.trim() || null;

  if (!byokKey) {
    const used = await freeQueriesUsed(session.githubId);
    if (used >= FREE_CAP()) {
      return NextResponse.json(
        {
          error: `You've used your ${FREE_CAP()} free traces. Add your own Anthropic API key to keep going — it stays in your browser, we never store it.`,
          freeTrialExhausted: true,
        },
        { status: 402 },
      );
    }
    const caps = await checkDailyCaps(session.githubId);
    if (!caps.allowed) {
      return NextResponse.json({ error: caps.error }, { status: caps.status });
    }
  }

  let result;
  try {
    result = await explainRegion(bundle, byokKey ? { apiKey: byokKey } : {});
  } catch (err) {
    // Fail safe on narration outages (exhausted credit, overload, auth):
    // clean 503 with a user-safe message, never a crash or a stack trace.
    if (err instanceof NarrationUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
  const latencyMs = Date.now() - started;

  const keySource = byokKey ? ("byok" as const) : ("house" as const);
  const queryId =
    result.kind === "answer"
      ? await logQuery({
          ...base,
          outcome: "answer",
          keySource,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costUsd: costUsd(result.model, result.usage),
          latencyMs,
          droppedClaims: result.dropped.claims,
          droppedTimeline: result.dropped.timeline,
          droppedCitations: result.dropped.citations,
        })
      : await logQuery({ ...base, outcome: "insufficient_model", keySource, latencyMs });

  return NextResponse.json({
    phase,
    quality: bundle.quality,
    result,
    evidence: slimEvidence(bundle),
    queryId,
  });
}
