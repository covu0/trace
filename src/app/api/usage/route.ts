import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { FREE_CAP, freeQueriesUsed } from "@/server/limits";

/** Free-trial meter for the UI: how many house-key traces this user has used. */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({
    freeUsed: await freeQueriesUsed(session.githubId),
    freeCap: FREE_CAP(),
  });
}
