# Trace

**The why layer for code.** Trace explains why code exists — not what it does — by reconstructing intent from commits, pull requests, and linked issues. Every claim cites its evidence; "insufficient evidence" is an honest first-class answer.

Docs: [PRD.md](./PRD.md) · [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)

## Status

Milestone 1 (skeleton): GitHub OAuth sign-in, public-repo ingest (bare clone + merged-PR fetch + commit↔PR mapping), why-signal scoring, live status UI. Region-based "why?" queries are Milestone 2–3.

## Stack

TypeScript · Next.js (App Router) · Postgres (Drizzle) · Auth.js (GitHub OAuth, JWT sessions) · system `git` · single Docker container on Railway.

## Development

Prereqs: Node 20+, `git` on PATH, a Postgres URL (Railway dev database works fine — no local Postgres needed).

1. Create a GitHub OAuth app at <https://github.com/settings/developers>:
   - Homepage: `http://localhost:3000`
   - Callback: `http://localhost:3000/api/auth/callback/github`
2. `cp .env.example .env.local` and fill in `DATABASE_URL`, `AUTH_SECRET` (`openssl rand -base64 32`), `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`.
3. Apply migrations, then run:

```bash
npx drizzle-kit migrate
npm run dev
```

## Deploy (Railway)

1. New project → **Deploy from GitHub repo** (Railway builds the `Dockerfile` automatically).
2. Add a **Postgres** service; reference its `DATABASE_URL` in the app service.
3. Add a **volume** mounted at `/data` (bare-clone cache; safe to wipe — clones are re-created on demand).
4. Set env vars: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (a second GitHub OAuth app with the production callback URL: `https://<app>.up.railway.app/api/auth/callback/github`).
5. Migrations run automatically on boot.

## Security posture (MVP)

- GitHub OAuth with **no scopes** — identity + public reads only, on the user's own rate limit. Tokens live in the encrypted session cookie, never in the database.
- `git` runs via `spawn` with `shell:false`, an allowlisted subcommand set, and `--` separators; clones are bare (nothing checked out, nothing executed).
- Repo content is an ephemeral cache on the volume — never long-term storage.
