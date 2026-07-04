import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { publicRepo } from "@/server/dto";
import { GitHubError, getRepo } from "@/server/github";
import { ensureRunning } from "@/server/ingest";

const MAX_SIZE_KB = 150 * 1024; // 150 MB cap — see TECHNICAL_DESIGN.md §3

const GITHUB_URL = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

const Body = z.object({ url: z.string().max(300) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  const match = parsed.success ? GITHUB_URL.exec(parsed.data.url.trim()) : null;
  if (!match) {
    return NextResponse.json(
      { error: "Enter a public GitHub repo as https://github.com/owner/repo" },
      { status: 400 },
    );
  }
  const [, owner, name] = match;

  let info;
  try {
    info = await getRepo(session.accessToken, owner, name);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return NextResponse.json({ error: "Repository not found (or not public)" }, { status: 404 });
    }
    throw err;
  }
  if (info.private) {
    return NextResponse.json({ error: "Private repos are not supported yet" }, { status: 400 });
  }
  if (info.sizeKb > MAX_SIZE_KB) {
    return NextResponse.json(
      { error: `Repo is ${(info.sizeKb / 1024).toFixed(0)} MB; the current limit is 150 MB` },
      { status: 400 },
    );
  }

  const existing = await db().query.repos.findFirst({
    where: (r, { and, eq }) => and(eq(r.owner, info.owner), eq(r.name, info.name)),
  });
  if (existing) {
    ensureRunning(existing, session.accessToken, session.githubId);
    return NextResponse.json({ id: existing.id });
  }

  const [row] = await db()
    .insert(schema.repos)
    .values({
      owner: info.owner,
      name: info.name,
      defaultBranch: info.defaultBranch,
      sizeKb: info.sizeKb,
      addedBy: session.githubId,
    })
    .returning();
  ensureRunning(row, session.accessToken, session.githubId);
  return NextResponse.json({ id: row.id }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const rows = await db()
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.addedBy, session.githubId))
    .orderBy(desc(schema.repos.createdAt));
  return NextResponse.json(rows.map(publicRepo));
}
