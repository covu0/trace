import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { publicRepo } from "@/server/dto";
import { RepoStatusView } from "@/components/RepoStatusView";

export const dynamic = "force-dynamic";

export default async function RepoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/");

  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const repo = await db().query.repos.findFirst({ where: eq(schema.repos.id, id) });
  if (!repo) notFound();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← back
      </Link>
      <h1 className="mt-4 font-mono text-2xl">
        {repo.owner}/{repo.name}
      </h1>
      <RepoStatusView initial={publicRepo(repo)} />
    </main>
  );
}
