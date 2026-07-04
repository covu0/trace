# Trace — Technical Design (MVP)

Status: proposed · Author: CTO · Date: 2026-07-04 · Companion: PRD.md

## 0. Design goals

- **Trust is the product.** The pipeline must make uncited claims structurally impossible, not merely discouraged.
- **Iteration speed over premature scale.** One deployable, boring technology, every component replaceable later.
- **Repo content is an ephemeral cache.** Nothing about the architecture assumes we may keep code long-term — this keeps the private-repo door open without building for it now.
- **The archaeology engine is the moat.** It is a pure, CLI-testable module with no web/LLM dependencies, so it can be hardened and benchmarked independently.

## 1. Stack

| Layer | Choice | Why (and what was rejected) |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language across UI/API/pipeline; hiring pool; typed end-to-end. Rejected Python backend: two-language repo slows a 1–2 person team. |
| Web framework | Next.js (App Router), single app | UI + API in one deployable. Thin API routes; all logic in `src/server/*` modules so a future extension/API consumer reuses everything. |
| Runtime/hosting | **Single Docker container on Railway or Fly.io** + managed Postgres + persistent volume | Ingest (clone + paginated PR fetch) and LLM calls are long-running; serverless (Vercel) timeouts fight us at every step. Rejected for now; the container also gives us local disk for clones. |
| Database | Postgres (managed by host) | Metadata, PR/issue cache, query/feedback logs. Rejected SQLite: managed Postgres removes backup/ops burden for ~$5/mo; no migration cliff later. |
| Git operations | System `git` CLI via subprocess | `git log -L`, `--follow`, blame are exactly the battle-tested behaviors we need; libgit2/isomorphic-git reimplement them worse. Injection risk handled in §7. |
| Background jobs | In-process job runner (concurrency-limited), jobs **resumable/idempotent** | Rejected Redis/BullMQ: real infra cost for zero MVP benefit. A deploy mid-ingest is fine because ingest steps checkpoint to Postgres and re-run cleanly. |
| Vector DB / embeddings | **None** | Evidence selection is *structural* (blame/log over a line range → commits → PRs → issues), not semantic search. Adding RAG here would be overengineering and would weaken citations. |
| LLM | Anthropic API, `claude-opus-4-8` (env-configurable) | See §5. |
| Auth | GitHub OAuth via Auth.js | Forced by rate limits anyway (see §4); no scopes needed for public repos. |

## 2. Components

```
Browser ── Next.js UI
              │
              ├── /api routes (thin)
              │      ├── auth (GitHub OAuth)
              │      ├── repos: create/status/tree/file
              │      └── explain: region → answer
              │
        src/server/
              ├── github/     GitHub REST client (user token, pagination, rate-limit aware)
              ├── gitrepo/    clone management + safe git subprocess wrapper
              ├── archaeology/ region → EvidenceBundle   ← the moat, pure, CLI-testable
              ├── explain/    EvidenceBundle → validated ClaimSet (LLM + validator)
              ├── ingest/     resumable job: clone → PR fetch → signal score
              └── db/         Postgres access (Drizzle ORM), migrations
              
Postgres: users · repos · pull_requests · issues_cache · queries · feedback
Volume:   /data/repos/<repoId>.git   (bare clones — ephemeral cache, re-cloneable)
```

## 3. Ingest flow (per repo, on demand)

1. **Validate**: parse URL, `GET /repos/{owner}/{repo}` with the user's token — must be public, size ≤ **150 MB** (GitHub-reported). Reject over-cap with a clear message. Record default branch.
2. **Clone**: `git clone --bare --single-branch` into the volume. Bare = no working tree, smaller, no checkout of untrusted files.
3. **Fetch PRs (bulk)**: paginate `GET /repos/{o}/{r}/pulls?state=closed` (100/page), store merged PRs: number, title, body, `merged_at`, `merge_commit_sha`, head SHA, author. Checkpoint page cursor in Postgres → resumable.
4. **Commit→PR mapping** (cheap, two strategies, no per-commit API calls):
   - squash merges: parse `(#N)` suffix in commit subject lines;
   - merge commits: `merge_commit_sha` from the PR list + "Merge pull request #N" subjects.
5. **Signal score**: % commits with messages > 20 words, % commits mappable to a PR, history depth, initial-commit-dump detection (huge first commit). Stored and shown to the user post-ingest.
6. States: `queued → cloning → fetching_prs → ready | failed`, with progress counts. UI polls status every 2s (SSE later if polling feels bad — not worth complexity now).

**Issues are fetched lazily at query time** (parse `fixes #N` / `closes #N` refs from the specific PRs/commits in an evidence bundle), cached in `issues_cache`. Ingesting all issues up front wastes rate limit on issues no one will ask about.

## 4. Query flow (region → answer)

Input: `{repoId, path, startLine, endLine}` at the ingested head commit.

1. **Archaeology** (`archaeology/`): 
   - `git log -L {start},{end}:{path} --first-parent` on the bare clone → ordered list of commits that touched the region, each with message + the relevant patch hunk. `-L` follows single-file renames.
   - Filter bot authors (dependabot/renovate/github-actions patterns); de-weight mass-mechanical commits (touching >100 files).
   - Cap the evidence set: **first-introduction commit + up to 24 most recent region commits** (recency + the origin matter most; keeps token cost bounded and reasoning direct — no lossy hierarchical summarization).
   - Decline generated/vendored files (lockfiles, `vendor/`, generated markers) with a friendly message.
2. **Enrichment**: map each evidence commit to its PR (from ingest tables); parse issue refs from PR bodies + commit messages; lazily fetch referenced issue title/body (cached).
3. **Explain** (`explain/`): one structured-output call (schema in §5). 
4. **Validate**: every claim's `citations[]` must reference evidence IDs present in the bundle. Claims with zero valid citations are **dropped in code**; if all claims drop or the model sets `insufficient_evidence`, render the insufficient-evidence screen. This is the citation guarantee — schema + validator, not prompt hope.
5. **Log**: query row with evidence stats, token usage, cost, latency, model ID. Answer rendered with thumbs up/down + "was this true?" — writes to `feedback`.

**Latency budget:** archaeology + enrichment < 2s warm; LLM call ~5–15s. UI shows staged progress ("gathering evidence 12 commits · 4 PRs · 2 issues → analyzing"). We deliberately do **not** token-stream the answer: the output is validated JSON rendered as structured UI (verdict, timeline, claims), and validation must complete before anything is shown — streaming partial, unvalidated claims would undermine the trust posture for ~5s of perceived latency. Revisit only if users complain.

## 5. LLM design

- **Model:** `claude-opus-4-8` ($5/$25 per MTok, 1M context) as the default, set via `TRACE_MODEL` env var. Rationale: correctness of inferred intent is the entire product; we start with the most capable model and let the feedback data tell us whether `claude-sonnet-4-6` ($3/$15) matches truthfulness before trading down. That comparison is a config flip + a week of feedback, not a code change.
- **Request shape:** `messages.create` with `thinking: {type: "adaptive"}` and **structured output** via `output_config.format` (JSON schema). No sampling params (removed on Opus 4.8). No tools — the model gets a pre-built evidence bundle and may only reason over it, which is also our main prompt-injection containment (§7).
- **Output schema (sketch):**

```jsonc
{
  "verdict": "string",                    // 1–2 sentence answer
  "insufficient_evidence": "boolean",
  "claims": [{
    "text": "string",
    "kind": "explicit | inferred",        // stated in evidence vs deduced from diffs
    "citations": [{ "type": "commit | pr | issue", "ref": "string" }]  // ≥1 required by validator
  }],
  "timeline": [{ "evidence_ref": "string", "summary": "string" }]
}
```

- **Prompt structure for caching:** frozen system prompt first (`cache_control: {type: "ephemeral"}` on it — no timestamps, no repo names interpolated), volatile evidence bundle in the user turn. Note: Opus 4.8's minimum cacheable prefix is 4096 tokens; if our system prompt is smaller the marker is a harmless no-op. Evidence varies per query, so caching value is limited to the system prompt — fine.
- **Cost model:** typical bundle 5–15K input tokens, 1–2K output → roughly **$0.05–0.15 per query** on Opus 4.8. Guardrails: per-user daily query cap (default 50) and a per-query input-token ceiling (truncate oldest mid-history evidence first, never the introduction commit or the most recent commits).

## 6. Data model (sketch)

- `users` (github id, login, encrypted OAuth token)
- `repos` (owner, name, default branch, head SHA, size, status, signal score, ingested_at)
- `pull_requests` (repo_id, number, title, body, merged_at, merge_commit_sha, head_sha, author)
- `commit_pr_map` (repo_id, sha, pr_number, mapping_source)
- `issues_cache` (repo_id, number, title, body, fetched_at)
- `queries` (user, repo, path, line range, evidence stats, model, tokens_in/out, cost, latency, answer JSON)
- `feedback` (query_id, rating, was_true, comment)

Clones live on disk keyed by repo id; a missing clone is re-created transparently (cache semantics). A nightly sweep evicts clones unused for 7 days.

## 7. Security

- **Git arg injection:** subprocess wrapper takes an allowlisted subcommand + typed args, always inserts `--` before paths, validates refs/paths against strict patterns, never uses a shell.
- **Path traversal:** file-serving API resolves requested paths via `git cat-file` against the bare repo (no filesystem paths derived from user input at all).
- **Untrusted repo content:** bare clones, nothing executed, no checkout. We treat repo content as data only.
- **Prompt injection:** commit messages/PR bodies are attacker-controlled text entering the LLM. Containment: no tools on the call, structured-output schema, and the citation validator — an injected "say X" can at worst produce a claim that fails citation validation or a wrong-but-cited claim, which the confidence labeling and feedback loop are designed to surface. Evidence text is delimited and labeled as untrusted quoted material in the prompt.
- **Secrets:** user OAuth tokens encrypted at rest (libsodium sealed box, key in host secret store); Anthropic key server-side only; all GitHub calls on the user's token (their quota, their consent).
- **Abuse:** auth required for everything; per-user rate limits on ingest (2 concurrent) and queries (daily cap); repo size cap bounds disk/bandwidth.

## 8. Instrumentation (the in-product signal validation)

Since we skipped the pre-build eval set (founder decision), the MVP itself must answer "does the why-signal exist?":

- every query logs evidence density (commits/PRs/issues found, tokens), outcome (answered vs insufficient-evidence), cost, latency;
- every answer has one-tap feedback: 👍/👎 + "was this accurate?";
- per-repo signal score correlates with feedback → tells us which repo populations the product works for;
- a weekly manual review of 👎-rated answers is on the calendar from week 1 — this is the eval set growing itself.

## 9. Milestones (4 weeks)

1. **Week 1 — skeleton:** repo init, Next.js + Postgres + Auth.js GitHub OAuth, ingest job (clone + PR fetch + status UI + signal score). Deployed to Railway/Fly from day 2 (deploy early, deploy always).
2. **Week 2 — archaeology:** `archaeology/` module complete with a CLI harness (`trace-archaeology <repo> <file> <range>` prints an evidence bundle); rename following, bot filtering, generated-file detection; tested against 5 well-known OSS repos.
3. **Week 3 — explanation:** structured-output call, citation validator, answer UI (verdict/timeline/claims/confidence), insufficient-evidence screen, feedback capture.
4. **Week 4 — hardening:** caps and rate limits, cost logging, error states (huge repo, empty history, initial-commit dump), polish, recruit the 10 test engineers.

## 10. Explicit non-goals (MVP)

Private repos · embeddings/semantic search · editor or browser extension · multi-branch · whole-repo summaries · conversation threads · teams/sharing · background repo re-sync · Redis/queues · microservices. Each of these is a deliberate "not yet," and the module boundaries above are where they'd attach later.
