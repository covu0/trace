export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-5xl font-semibold tracking-tight">Trace</h1>

      <p className="text-lg text-zinc-400">
        The <span className="text-zinc-100">why</span> layer for code.
      </p>

      <input
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm"
        placeholder="Paste GitHub repo URL..."
      />

      <button className="rounded-lg bg-zinc-100 px-5 py-2.5 font-medium text-zinc-900">
        Trace it
      </button>
    </main>
  );
}