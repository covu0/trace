import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { db, schema } from "@/db";
import { publicRepo } from "@/server/dto";
import { AddRepoForm } from "@/components/AddRepoForm";
import { SignalBadge, StatusBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
        <h1 className="text-5xl font-semibold tracking-tight">Trace</h1>
        <p className="text-lg text-zinc-400">
          The <span className="text-zinc-100">why</span> layer for code. Trace explains why code
          exists — not what it does — by reconstructing intent from commits, pull requests, and
          issues. Every claim cited, or honestly not made.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button className="rounded-lg bg-zinc-100 px-5 py-2.5 font-medium text-zinc-900 hover:bg-white">
            Sign in with GitHub
          </button>
        </form>
        <p className="text-xs text-zinc-500">
          No scopes requested — Trace only reads public repositories, on your own rate limit.
        </p>
      </main>
    );
  }

  const rows = await db()
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.addedBy, session.githubId))
    .orderBy(desc(schema.repos.createdAt));
  const myRepos = rows.map(publicRepo);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-10 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Trace</h1>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <span>{session.login}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Analyze a public repository
        </h2>
        <AddRepoForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your repositories
        </h2>
        {myRepos.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing yet — paste a repo URL above.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {myRepos.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/repos/${r.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900"
                >
                  <span className="font-mono text-sm">
                    {r.owner}/{r.name}
                  </span>
                  <span className="flex items-center gap-2">
                    {r.signal && <SignalBadge signal={r.signal} />}
                    <StatusBadge status={r.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
