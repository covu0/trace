# Trace — Engineering Backlog

Named items that must not get lost. Ordered roughly by product risk.

## Citation relevance scoring (M4/eval — flagged by founder 2026-07-06)

The citation validator proves a cited commit/PR/issue **exists** in the
evidence bundle; it cannot judge whether it actually **supports** the
sentence. Observed in the wild during M4 latency runs: one Sonnet claim cited
a real but loosely-related commit. "A real citation" vs "the right citation"
is the difference between being trustworthy and looking trustworthy.

Direction: needs the feedback corpus (accuracy ratings per answer) and/or a
second-pass relevance check (cheap model grading claim↔evidence entailment,
sampled). Do not ship a relevance score we haven't validated against human
judgment — that would be the same sin one level up.

## Truth eval set

20–30 hand-verified regions from well-known OSS repos where the real "why"
is documented. Run on every prompt/model/pipeline change; report
truthful-and-useful rate. Feedback data (M4) grows this organically; seed it
manually when volume is low.

## Opus vs Sonnet truthfulness A/B

Once feedback capture has volume: same regions, both models, compare accuracy
ratings — replace the eyeball judgment that picked Sonnet with data.

## Operational

- Clone-eviction sweep (7-day unused clones; disk is a finite volume)
- Mid-ingest kill/resume test as a scripted check (resume-on-poll is designed
  but only manually verified)
- CLI scripts: clean DB teardown to silence the cosmetic Windows
  `uv async.c` assertion on exit
- Region-history cache: `git log -L` output per (repo, path, range, head)
  is deterministic — cacheable if query latency on big files becomes a issue
- Prompt-cache warmth: verify cache_read_input_tokens > 0 on consecutive
  queries; system prompt must stay byte-stable
