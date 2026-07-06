import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { buildEvidenceBundle } from "@/server/archaeology";
import { explainRegion } from "@/server/explain";

const Body = z.object({
  path: z.string().min(1).max(500),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide path, startLine and endLine" }, { status: 400 });
  }

  const bundle = await buildEvidenceBundle(
    { repoId: id, ...parsed.data },
    session.accessToken,
  );
  if ("declined" in bundle) {
    return NextResponse.json({ error: bundle.reason }, { status: 400 });
  }

  const result = await explainRegion(bundle);

  return NextResponse.json({
    quality: bundle.quality,
    result,
    // Slim evidence for citation-chip links and the insufficient view.
    evidence: {
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
    },
  });
}
