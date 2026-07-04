# Trace — PRD (MVP)

**One-liner:** Trace answers "why does this code exist?" for any region of code in a public GitHub repository, by reconstructing intent from commits, pull requests, and linked issues.

## Product principles (non-negotiable)

1. **Every claim cites evidence.** Each assertion in an answer links to a commit SHA, PR number, or issue number. No uncited claims are ever shown — enforced in code, not by prompt.
2. **Confidence is visible.** "Stated explicitly in PR #482" is distinguished from "inferred from the shape of the diff."
3. **"Insufficient evidence" is a first-class answer.** When the history is thin, Trace says so instead of confabulating. This is a designed screen, not an error state.
4. **Why, not what.** Positioning stays sharp: we explain intent and origin, not behavior. "What does this do" questions get a graceful redirect, not an error.

## Scope

- **In:** Public GitHub repos up to a size cap (default branch only). GitHub OAuth sign-in. Region-scoped queries ("select lines → why is this here?") as the primary interaction. File-level evolution timeline as a supporting view. Repo signal-quality indicator after ingest. Per-answer feedback capture.
- **Out (MVP):** Private repos, editor/browser extensions, teams/orgs/sharing, whole-repo batch summaries, multi-branch analysis, chat threads, submodules.

## Users

Software engineers working in unfamiliar or legacy codebases. Week-one user: an engineer who pastes a repo they already work in and asks about the weird code they've wondered about.

## Flow

Sign in with GitHub → paste public repo URL → transparent ingest (progress + signal-quality score) → browse files → select a region → "Why is this here?" → structured answer: verdict, evidence timeline, cited claims with confidence, links out to GitHub.

## 30-day success criterion

10 engineers use Trace on a repo they already know well and rate ≥70% of answers as both **true** and **useful**. Signal validation happens inside the MVP via instrumentation and per-answer feedback (replacing a pre-build eval set, per founder decision 2026-07-04).

## Known risks (accepted)

- Why-signal density varies wildly by repo; worst on the legacy code that hurts most. Mitigated by PR/issue ingestion, the signal-quality indicator, and honest insufficient-evidence answers.
- The business is ultimately private repos; MVP proves value, not revenue. Architectural guardrail: repo content is an ephemeral cache, never a long-term store.
- One confident fabrication destroys trust. Mitigated by the citation-mandatory pipeline (see TECHNICAL_DESIGN.md).
