# S3 (Batch API for offline jobs) — ORIENT REVISE signal (blocked on scope decision)

Date: 2026-06-20. Disposition: **[B] blocked — premise does not survive contact with the code.**
Raised per build-loop ORIENT stale-plan rule ("if an executor finds the plan contradicts the code, raise a bounded REVISE signal; do not silently follow the sketch"). No worktree was created (ORIENTed read-only from main first).

## Backlog ask (S3)

Route the **classifier eval** and the **proof-quality report generation** through the Message Batches API (flat 50% off), key by `custom_id`. Research source: f18 (P1) + roadmap item 3 ("Eval suites in /evals, proof-quality report surface", Effort M).

## Ground truth (file:line)

### Target A — "proof-quality report generation": NOT a batch job

- `packages/core/src/reports/compute-receipted-booking-quality.ts:53` — the thing literally called the "proof-quality summary" is **pure DB aggregation, zero LLM calls**. Nothing to batch.
- The only reports LLM call is `packages/core/src/reports/pull-quote-generator.ts:161` — a **single** `messages.create` per report (3 text slots in one call).
- `apps/api/src/services/reports/assemble-weekly-report.ts:74` — the **weekly cron path passes `llm: null`**, so the scheduled/offline path makes **no** Anthropic call.
- `apps/api/src/routes/dashboard-reports.ts:88` — the only path that actually fires the LLM is the **on-demand dashboard route**: one synchronous, user-facing call per report view.
- Verdict: there is no offline _bulk_ report-LLM job. Batching a single latency-sensitive on-demand call is architecturally wrong (Batches API is async, minutes-to-24h; the user is waiting on a dashboard request).

### Target B — "classifier eval": batch-able shape, but wrong tool + stop-glob

- `packages/core/src/governance/classifier/eval/run-eval.ts:95` — 2 models x 46 golden = **92 sequential calls** (nested `for...of`, no `Promise.all`). Independent calls, so technically batch-able.
- BUT it **is the CI gate**: `.github/workflows/ci.yml` runs `pnpm eval:classifier` per-PR on classifier paths + on main push. A CI gate needs **bounded, predictable latency**. The Batches API SLA is "within 24h" (often minutes, not guaranteed) — routing a required CI gate through it introduces unbounded/flaky latency. Net regression.
- Cost savings are negligible: ~92 small calls/run (256 max_tokens out), ~$0.50/run; 50% off saves ~$0.25/run (~$4/week at observed cadence). Not worth async complexity + a new batch-timeout failure mode.
- Path is under `packages/core/src/governance/...` → **governance merge-stop glob** → would SURFACE anyway (the backlog's `[AUTO]` tag is incorrect for this target).

## Why not "just do half"

Implementing batch-routing for the eval would (a) make a governance CI gate async/unpredictable, (b) violate "no premature abstractions / evidence over assertion" for ~$4/week, (c) deliver negative value (more complexity, slower/flakier CI). The report half has literally nothing to batch. So there is no clean in-scope sub-slice that is a net win.

## Recommendation (user decision)

1. **Drop S3** as specified — f18 is a valid general finding, but neither named job is a suitable offline batch target in the current codebase. OR
2. **Re-scope** S3 to a genuine future offline bulk LLM job when one appears (e.g. a large offline re-classification backfill, or an eval set that grows past rate limits and is run nightly _separately_ from the CI gate). None exists today; creating one is scope expansion, out of bounds for this loop.

## Adjacent (out of current scope — NOT implemented; for the user to consider separately)

The eval's real pain is the 92 **sequential** calls (~2-3 min wall-clock), not cost. A bounded-concurrency `Promise.all` (e.g. 5-8 in flight) would cut that to ~30s with zero async-batch risk and no governance-architecture change. That is a different change than f18 asks for, so it was not done here.
