import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/db";

const Body = z.object({
  queryId: z.number().int().min(1),
  rating: z.enum(["up", "down"]),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });

  // Users may only rate their own queries.
  const query = await db().query.queries.findFirst({
    where: and(
      eq(schema.queries.id, parsed.data.queryId),
      eq(schema.queries.userId, session.githubId),
    ),
  });
  if (!query) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rating = parsed.data.rating === "up" ? 1 : -1;
  await db()
    .insert(schema.feedback)
    .values({ queryId: query.id, rating })
    .onConflictDoUpdate({ target: schema.feedback.queryId, set: { rating } });

  return NextResponse.json({ ok: true });
}
