import { auth } from "@/auth";
import { TraceItForm } from "@/components/TraceItForm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-5xl font-semibold tracking-tight">Trace</h1>

      <p className="text-lg text-zinc-400">
        The <span className="text-zinc-100">why</span> layer for code.
      </p>

      <TraceItForm authed={!!session} login={session?.login ?? null} />
    </main>
  );
}
