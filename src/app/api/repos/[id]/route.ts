import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { publicRepo } from "@/server/dto";
import { ensureRunning } from "@/server/ingest";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const repo = await db().query.repos.findFirst({ where: eq(schema.repos.id, id) });
  if (!repo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Resume-on-poll: if the container restarted mid-ingest, this authenticated
  // poll restarts the job from its checkpoints using the caller's token.
  ensureRunning(repo, session.accessToken, session.githubId);

  return NextResponse.json(publicRepo(repo));
}
