# D8 — Operational Robustness & Scale

> Raw domain audit. `file:line` against `main` + post-Eyes worktree. Synthesis: [`../FINDINGS.md`](../FINDINGS.md).

## 1. CURRENT STATE

**The weekly-audit pipeline.** Cron `ad-optimizer-weekly-audit`, `retries:2`, `0 9 * * 1` (Mondays 09:00 UTC), registered `inngest.ts:778`; defined `inngest-functions.ts:163-183`. Fan-out `executeWeeklyAudit` (`inngest-functions.ts:95-149`): one `step.run("list-deployments")`, then a **serial `for` loop over deployments**, each with `creds-/pixel-/audit-${id}` steps. **No `Promise.all`, no step fan-out, no per-deployment function.** The entire `runner.run()` executes inside the single `audit-${id}` step; `AuditRunner.run()` has **zero `step.` calls** (cannot checkpoint mid-run). One `MetaAdsClient` per deployment (`inngest-functions.ts:112`), so its `lastCallAt` clock serializes every Graph call within a deployment.

**Per-campaign loop** (`audit-runner.ts:342-429`): serial `getCampaignLearningData` (5a, `:344`) then `getTargetBreachStatus` (5e, `:399`). Eyes landed in the provider/client, not the loop.

**Rate limiter** (`meta-ads-client.ts:9,246-254`): `RATE_LIMIT_MS=60_000`; sleeps `60s − elapsed` before every get/post. **No 429 handling, no Retry-After, no backoff, no jitter** (grep empty). On throttle, `handleResponse` just `throw`s.

**Real per-campaign Graph cost (post-Eyes):** `getCampaignLearningData` → `getCampaignInsights` (1) + `getAdSetLearningInputs` (1 entity-edge + 1 internal `getAdSetInsights`) = 3; `getTargetBreachStatus` → 1. = **4 serial Graph calls/campaign.** Plus per-deployment fixed ~5 (2× campaign-insights + `getAccountSummary`'s 3).

**Provider wiring (the "two providers").** Weekly-audit on `main` (post-#792) = `new MetaCampaignInsightsProvider(adsClient)` (`inngest.ts:242`). The provider at `~714` (`createMetaInsightsProviderForOrg`, `meta-insights-adapter.ts`) is a **different interface** — `MetaInsightsProvider.getWindowMetrics` for the outcome-attribution worker, NOT the weekly-audit's `CampaignInsightsProvider`. (Not a duplicate — two roles.)

**Idempotency.** `emitRecommendation` computes `sha256(orgId::intent::sortedTargets::dayBucket)` (`emit.ts:15-23`); `recordEmission` does the Recommendation+WorkTrace dual-write in one `$transaction`, P2002 → returns existing + skips WorkTrace. Day-bucketed dedup.

**OAuth.** `refreshTokenIfNeeded` (`facebook-oauth.ts:109-122`) refreshes within `REFRESH_THRESHOLD_DAYS=7` of expiry → 60-day token; driven by `createMetaTokenRefreshCron` (`inngest.ts:798`).

**Deploy host.** apps/api = long-lived Render Docker container (`render.yaml`, `numInstances:1`, `plan:starter`) — NOT serverless. Inngest uses `serve` transport (SDK `DefaultMaxRuntime.serve=10s` vs `connect=300s`).

## 2. GAPS / WEAKNESSES

**(a) Scale ceiling — the headline.** Serial × 60s/call × ~4 calls/campaign, serial across deployments:

| Campaigns | Graph calls/deployment | Wall time (1 deployment) |
| --------- | ---------------------- | ------------------------ |
| 5         | 25                     | ~24 min                  |
| 10        | 45                     | ~44 min                  |
| 50        | 205                    | ~3.4 hours               |

10 orgs × 10 campaigns ≈ **7+ hours**; 50 orgs × 10 ≈ a day-plus — past the next weekly tick. The in-code TODO confirms `N_deployments × N_campaigns × 60s`. **Spec §7's "negligible volume… one call per campaign" is wrong** (~4 calls/campaign × 60s floor).

**(b) The 60s rate limit is wildly over-conservative + unprincipled** — ignores Meta's header-driven budgets (`X-Business-Use-Case-Usage`, `X-Ad-Account-Usage`). Biggest throughput killer.

**(c) No batching/field-expansion.** `getCampaignInsights` already returns **all campaigns in one account-level call** (`level:"campaign"`, `:75-93`) — yet the provider re-queries per campaign and `.find()`s one row (`meta-campaign-insights-provider.ts:39,98`). The daily-breach call pulls every campaign's daily rows once **per campaign** and filters to one. **The data to do the whole audit in O(1)–O(2) account-level calls is already fetched and discarded N times.** `?ids=`/batch API unused.

**(d) No retry/backoff on throttle → retries amplify load.** On 429 the `audit-${id}` step throws; Inngest retries (×2) the **entire step**, re-running ALL campaigns from call #1. No `NonRetriableError` for permanent errors (bad token, deleted account) → those also burn 3 attempts at 60s/call.

**(e) Inngest step-timeout collision.** A single `audit-${id}` step blocks tens of minutes inside one `serve` HTTP request (10s SDK budget + Render proxy timeout). The safe pattern is many short steps. No `concurrency`/`throttle`/`rateLimit`/`timeouts` option set (grep empty).

**(f) `coverage-validator` is ORPHANED** — defined/tested/exported (`index.ts:58`) but **instantiated nowhere** in production. Riley's audit runs against any active deployment with no usable-data check. No data-sufficiency gate.

**(g) OAuth refresh single-attempt + fragile.** 7-day threshold + weekly cron means a token expiring mid-week can go stale; password change / permission revocation / 90-day inactivity undetected; first symptom is an audit-wide failure. No token-health probe.

**(h) Observability — an operator can't tell the audit silently produced nothing.** Weekly-audit `onFailure` is `alert:false` (`inngest.ts:785`) — retry-exhaustion only writes a ledger row, no page. Worse, the dominant failure mode is silent: a stub/blind provider "succeeds" with zero recommendations, indistinguishable from "all healthy." **No metric/alert for "0 recommendations across N campaigns"** (grep empty); only a `console.warn` rollup (`audit-runner.ts:549-552`).

**(i) Minor: non-idempotent audit-report task on retry.** `saveAuditReport` always `taskStore.create()` (`inngest.ts:246`) inside the retryable step → a fail-then-succeed step leaves a duplicate `category:"audit"` row.

**(j) No paging.** `getCampaignInsights` reads page 1; `getAdSetLearningInputs` page 1 (`limit:200`). >~25 campaigns or >200 ad sets silently truncates (fails toward inaction, but invisibly).

**(k) Adjacent latent bug (outcome worker, not weekly-audit).** `meta-insights-adapter.ts:60` requests daily rows via `breakdowns:["day"]`, but Meta's daily series is `time_increment=1`; `"day"` is not a valid breakdown dimension.

## 3. RANKED RECOMMENDATIONS (by "blocks reliable production operation")

**R1 — Wire the real provider into the weekly audit (= PR1 Eyes).** ✅ DONE on `main` via #792 (`inngest.ts:242`). _(Was the top blocker; now landed.)_ _TAG: PR1._

**R2 — Replace per-campaign provider calls with account-level batch fetch.** Fetch once per deployment (account-level 7-day insights + one `time_increment=1` daily pull + one ad-set learning pull), index by campaignId in-memory; drop the per-campaign round-trips (`audit-runner.ts:344,399`). **Collapses ~4×N calls to ~3-4 total per deployment** — the single highest-leverage scale fix; removing waste, not adding risk. `meta-campaign-insights-provider.ts`; `audit-runner.ts:342-429`. Effort M, risk med (needs the PR4 snapshot test). Deps R1. _TAG: PR-Scale (new; upgrades the spec §7 risk to a blocker)._

**R3 — Header-aware adaptive throttling + 429 backoff.** Read Meta usage headers, sleep only when high; lower the floor; honor `Retry-After`/exponential backoff+jitter on 429/codes 17/613/80004. `meta-ads-client.ts:9,230-254`. Effort M, risk med. _TAG: PR-Scale._

**R4 — Per-deployment step fan-out** (dispatcher→worker; the `createWeeklyAuditDispatcher` shape exists, unused, `inngest-functions.ts:274-302`; the outcome worker already uses it). Add a `concurrency` cap. Removes cross-deployment serialization + the long-single-step collision. Effort M, risk med. Deps R2 preferred first. _TAG: PR-Scale._

**R5 — Observability: alert on retry-exhaustion AND zero-output audits.** Flip `onFailure alert:true` (`inngest.ts:785`); add a metric/alert when an audit completes with 0 recs+watches across ≥1 active campaign (audit-health gauge). `audit-runner.ts:533-553`. Effort S-M, risk low. _TAG: PR-Scale / Ops._

**R6 — Gate Riley activation/audit on `coverage-validator`.** Call `CoverageValidator.validate()` at activation and/or Step 0; refuse/watch-only below threshold. Effort M, risk low-med. _TAG: PR2-adjacent / onboarding._

**R7 — Harden token lifecycle.** `NonRetriableError` for auth errors (190/102) so a dead token doesn't burn 3×60s + flips connection to `error`+alert; add a token-health probe to the daily-check cron. `meta-ads-client.ts:230-244`; `facebook-oauth.ts`. Effort S-M. Deps R5. _TAG: PR-Scale / Ops._

**R8 — Idempotent audit-report task + paging.** Upsert `saveAuditReport` on a deterministic key; follow `paging.next`. Effort S each. _TAG: PR-Scale cleanup._

**Ranking note:** the documented concern was "60s × per-campaign serial calls." Confirmed + quantified — but the deeper finding is that **batching makes the per-campaign calls unnecessary entirely** (account-level data already over-fetched and discarded N×), so R2 (batch) ranks above R3 (saner limit) and R4 (parallelize): fix the redundancy first.

## 4. VERIFICATION LOG

Read spec §7 (refuted). Read `inngest.ts` (main post-#792 real provider `:242`; `createMetaInsightsProviderForOrg` `:714` is the outcome-worker interface; `onFailure alert:false` `:785`; V2 deps not wired). Read `inngest-functions.ts` (serial loop, single step, scale TODO `:85-93`, unused dispatcher `:274-302`). Read `meta-ads-client.ts` (`RATE_LIMIT_MS=60_000`, instance `lastCallAt`, no 429/backoff/paging). Read `audit-runner.ts` (per-campaign serial calls, no `step.`). Counted 4 Graph calls/campaign. Read `emit.ts`+emission-mirror (day-bucketed idempotency). Read `coverage-validator.ts` + repo grep (orphaned). Read `facebook-oauth.ts` (7-day single-attempt). Read `makeOnFailureHandler` (`alert:false` ⇒ no page). Inspected `inngest@4.2.4` types (`serve=10s`; concurrency/throttle/rateLimit/timeouts unused). Read `render.yaml` (long-lived container). Spotted `breakdowns:["day"]` bug (`meta-insights-adapter.ts:60`).
