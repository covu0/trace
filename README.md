# Trace

**The why layer for code.** Trace explains why code exists — not what it does — by reconstructing intent from commits, pull requests, and linked issues. Paste a public GitHub repo, select a region of code, ask why.

## The honesty gate

Trace's core property is that it cannot make things up:

- **Deterministic evidence-quality gate.** Every region's evidence is rated `rich / partial / poor` by code, not by the model. A `poor` region returns the literal *"Not enough evidence to answer confidently"* — the LLM is never invoked for it.
- **Citation validator.** The narrative is generated as sentence-level claims, each citing commits/PRs/issues. After generation, every citation is resolved against the actual evidence bundle; any sentence whose citations don't resolve is **dropped, not softened**. A hallucinated reference structurally cannot reach the screen.
- **Visible confidence.** The evidence-quality banner (with the engine's reasons, verbatim) renders before the narrative; inferred claims are tagged; validator drops are disclosed.

## Run locally

Prereqs: Node 20+, git, a Postgres database, a GitHub OAuth app (callback `http://localhost:3000/api/auth/callback/github`), an Anthropic API key.

```sh
npm install
cp .env.example .env.local   # fill in all values
npx drizzle-kit migrate
npm run dev                  # http://localhost:3000
```

Sign in with GitHub, paste a public repo URL (≤150 MB), wait for ingest, then ask "why" about any file region.

### CLI harnesses (no web UI needed)

```sh
npx tsx scripts/ingest.ts owner/repo            # ingest a repo
npx tsx scripts/archaeology.ts 1 src/index.ts 1 40   # evidence bundle + quality
npx tsx scripts/explain.ts 1 src/index.ts 1 40       # full cited narrative
npx tsx scripts/test-caps.ts                    # spend-cap boundary tests
```

## Spend protection

Per-user (`TRACE_DAILY_QUERY_CAP`, default 50) and global (`TRACE_GLOBAL_DAILY_QUERY_CAP`, default 100) daily caps on LLM-invoking queries; zero-token outcomes don't count. Narration outages degrade to a clean 503, never a retry storm.

## Docs

[PRD.md](./PRD.md) · [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) · [BACKLOG.md](./BACKLOG.md)
