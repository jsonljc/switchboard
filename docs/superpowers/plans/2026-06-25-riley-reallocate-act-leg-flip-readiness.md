# Riley reallocate act-leg flip-readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the forward guardrail monitor, the governed automated rollback, and an in-flight kill-switch so Riley's reallocate act-leg could be flipped on for ONE canary org (runbook §1-4). The act leg stays DARK.

**Architecture:** A new allow-only, PLATFORM_DIRECT `reset_prior_budget` intent auto-executes a restore-to-captured-prior. A new always-on daily monitor cron measures each applied reallocation's blast-radius guardrails over its window and dispatches the reset on a breach. The reallocate executor gains a runtime, per-deployment kill-switch checked at the last mile. A staged integration test exercises breach -> rollback -> halt.

**Tech Stack:** TypeScript ESM monorepo, Zod schemas, Prisma, Inngest crons, Vitest, PlatformIngress.

## Global Constraints

- ESM only, `.js` extensions in relative imports. No `any` (use `unknown`). No `console.log` (use `console.warn`/`console.error`). Unused vars prefixed `_`.
- Prettier: semi, double quotes, 2-space, trailing commas, 100 width. Conventional Commits, lowercase subject.
- No em-dashes in prose/comments (user style rule). Use colons, parentheses, periods.
- Co-located `*.test.ts` for every new module. `pnpm --filter <pkg> exec tsc --noEmit` + touched-pkg tests before every commit. `pnpm eval:riley` green.
- A new `SwitchboardMetrics` counter needs ALL THREE registries: `packages/core/src/telemetry/metrics.ts` (interface + `createInMemoryMetrics`), `apps/api/src/metrics.ts`, `apps/chat/src/bootstrap/metrics.ts`.
- A new auto-execute intent needs all three or it is prod-inert: allow-only governance seed + `PLATFORM_DIRECT_WORKFLOW_INTENTS` entry + handler/intent registration in `contained-workflows.ts`.
- Dollars normalize once at the gate boundary; cents end to end everywhere else.
- DB down locally: `pnpm install` + `pnpm build` once + `pnpm db:generate`. db tests use mocked Prisma (no Postgres in CI).

---

## PR-2: `reset_prior_budget` dispatch path (the rollback target)

Mergeable alone: nothing calls it yet. Mirrors the reallocate executor/seed/submit patterns.

### Task 2.1: Reset receipt schema variant

**Files:** Modify `packages/schemas/src/execution-receipt.ts`; Test `packages/schemas/src/execution-receipt.test.ts`.

**Interfaces — Produces:** `ExecutionReceiptSchema` becomes `z.discriminatedUnion("kind", [reallocationReceipt, resetReceipt])`. New `CampaignBudgetResetReceipt` fields: same money fields as reallocation (`organizationId, deploymentId, adAccountId, campaignId, workTraceId, executionWorkUnitId, requestedToCents, observedPriorCents, appliedCents, deltaCentsSigned, executedAt`) MINUS `approvedLifecycleId`/`bindingHash`/`requestedFromCents` (a reset has no human approval lifecycle), PLUS `kind: z.literal("campaign_budget_reset")`, `rollbackOfWorkUnitId: z.string()` (the forward reallocation's execution work unit), `breachMetric: z.enum(["account_booked_conversions_drop_share","freed_budget_absorbed_share"])`, `breachReason: z.enum(["exceeded","unmeasured"])`.

- [ ] Step 1: Write failing tests: the reallocation variant still parses unchanged; a valid reset receipt parses; a reset receipt missing `rollbackOfWorkUnitId` fails; the union discriminates on `kind`.
- [ ] Step 2: `pnpm --filter @switchboard/schemas test execution-receipt` -> FAIL.
- [ ] Step 3: Refactor to a discriminated union, keep `PositiveSafeCents`, export `CampaignBudgetResetReceipt` type.
- [ ] Step 4: tests PASS; `pnpm --filter @switchboard/schemas exec tsc --noEmit`.
- [ ] Step 5: Commit `feat(schemas): add campaign_budget_reset execution-receipt variant`.

### Task 2.2: Reset submit-request builder + intent constant

**Files:** Create `apps/api/src/services/workflows/riley-reset-budget-submit-request.ts`; Test `__tests__/riley-reset-budget-submit-request.test.ts`.

**Interfaces — Produces:** `RILEY_RESET_PRIOR_BUDGET_INTENT = "adoptimizer.campaign.reset_prior_budget"`. `RileyResetBudgetSubmitInput = { organizationId, deploymentId, adAccountId, campaignId, targetCents, rollbackOfWorkUnitId, breachMetric, breachReason }`. `buildRileyResetBudgetSubmitRequest(input): CanonicalSubmitRequest | null`.

Mirror `buildRileyBudgetSubmitRequest` EXCEPT: actor `{id:"system",type:"system"}`; NO `targetHint` (so the resolver derives skillSlug `adoptimizer` and the PLATFORM_DIRECT carve-out applies); NO `spendAmount` in parameters (a restore is not an outbound spend decision; omitting it keeps the spend gate from parking it); `trigger:"internal"`; idempotencyKey `reset:${input.rollbackOfWorkUnitId}` (one reset per forward move); parameters carry the frozen `{ deploymentId, adAccountId, campaignId, targetCents, rollbackOfWorkUnitId, breachMetric, breachReason }`. Return null when `targetCents` is not a positive safe integer.

- [ ] Steps: failing test (intent constant value; null on non-positive/non-integer targetCents; no spendAmount key; no targetHint; idempotencyKey shape) -> implement -> pass -> tsc -> commit `feat(api): reset_prior_budget submit-request builder`.

### Task 2.3: Reset executor (set-to-absolute restore)

**Files:** Create `apps/api/src/services/workflows/riley-reset-budget-execution-workflow.ts`; Create `apps/api/src/bootstrap/riley-reset-budget-executor.ts`; Tests co-located.

**Interfaces — Consumes:** `RILEY_RESET_PRIOR_BUDGET_INTENT`. **Produces:** `buildRileyResetBudgetExecutionWorkflow(deps): WorkflowHandler`; `buildRileyResetBudgetExecutorHandler(prismaClient): Promise<{intent,handler}>`; `RILEY_RESET_EXECUTION_RESOLVED_BY = "riley_reset_self_execution"`.

Executor input schema `RileyResetBudgetExecutionInput` (Zod, new in schemas or local): `{ deploymentId, adAccountId, campaignId, targetCents (positive safe int), rollbackOfWorkUnitId, breachMetric, breachReason }`. Steps in `execute(workUnit)`:

1. Zod parse parameters -> fail closed `INVALID_RESET_INPUT`.
2. Resolve credentials by the FROZEN `input.deploymentId` (NOT `workUnit.deployment.deploymentId`, which is `platform-direct`): `getDeploymentCredentials(workUnit.organizationId, input.deploymentId)` with the same `org_mismatch`/`none` contract as the reallocate executor. The closure verifies `deployment.organizationId === workUnit.organizationId` before decrypt. Map org_mismatch -> `DEPLOYMENT_ORG_MISMATCH`, none -> `NO_META_CONNECTION`.
3. Frozen-account lock: `creds.accountId !== input.adAccountId` -> `ACCOUNT_MISMATCH`.
4. Live read `getCampaign(campaignId)`; null/throw -> `CAMPAIGN_BUDGET_UNREADABLE`/`UNSUPPORTED_BUDGET_TOPOLOGY`.
5. Idempotent no-op: if `live === input.targetCents`, return `completed` with `{ restored:false, reason:"already_at_prior" }` (no Meta write).
6. Write `updateCampaignBudget(campaignId, input.targetCents)`; throw -> `META_RESET_WRITE_ERROR` (no marker; the reset relies on ingress idempotency + absolute-set, so a retry re-sets the same value).
7. Re-read; `applied !== input.targetCents` -> `RESET_POST_WRITE_MISMATCH`.
8. Build + validate the `campaign_budget_reset` receipt (deltaCentsSigned = applied - live); invalid -> `RESET_RECEIPT_INVALID`.
9. Return `completed`, outputs `{ receipt, restored:true }`.

NO blast-radius cap and NO drift check: the reset is bounded-by-construction (it restores the captured prior, whose forward delta was already within the cap, so the reverse delta has equal magnitude) and drift is EXPECTED (the forward move drifted it). Document both omissions in the executor header.

- [ ] Steps: failing tests (invalid input; org_mismatch; account mismatch; unreadable; already-at-prior no-op writes nothing; happy path writes targetCents + emits reset receipt; post-write mismatch) -> implement -> pass -> tsc -> commit `feat(api): reset_prior_budget set-to-absolute restore executor`.

### Task 2.4: Reset governance seed (allow-only)

**Files:** Create `packages/db/src/seed/riley-reset-budget-governance.ts`; Test `__tests__`/sibling. Export from `packages/db/src/index.ts`.

**Interfaces — Produces:** `RILEY_RESET_BUDGET_ALLOW_POLICY_RULE` (anchored regex `^adoptimizer\\.campaign\\.reset_prior_budget$`), `rileyResetBudgetAllowPolicyId(orgId)`, `buildRileyResetBudgetAllowPolicyInput(orgId)`, `seedRileyResetBudgetPolicies(client, orgId)`.

ONE allow policy ONLY (no require_approval sibling): allow-only is the auto-execute capability. Header comment: "Unlike the reallocate seed this is allow-ONLY on purpose: the automated rollback is a safety reversal to a captured prior and must execute without a human. It is NOT system_auto_approved (it uses the policy-engine allow path), so the D9-2 FINANCIAL_AUTO_APPROVE_DENYLIST does not apply and the reset is deliberately absent from it." Mirror the regex-anchoring test from `seed-riley-budget-governance.test.ts` (matches exact, rejects `.extra` and `x`-prefixed).

- [ ] Steps: failing tests (regex anchoring; allow effect; deterministic id; idempotent upsert via mocked Prisma) -> implement -> pass -> tsc -> commit `feat(db): allow-only governance seed for reset_prior_budget`.

### Task 2.5: Provisioning wire + PLATFORM_DIRECT + handler/intent registration

**Files:** Modify `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts` (call `seedRileyResetBudgetPolicies` alongside `seedRileyReallocatePolicies` in the same tx); Modify `apps/api/src/bootstrap/platform-deployment-resolver.ts` (add the intent to `PLATFORM_DIRECT_WORKFLOW_INTENTS`); Modify `apps/api/src/bootstrap/contained-workflows.ts` (build `rileyResetExecutor`, add to handlers map, add a `workflowIntents` entry: `budgetClass:"cheap"`, `approvalPolicy:"none"`, `allowedTriggers:["internal"]`).

`PLATFORM_DIRECT_WORKFLOW_INTENTS` entry needs a comment: "Riley's automated reset-to-prior rollback: an allow-only safety reversal whose `adoptimizer` slug has no seeded deployment. platform-direct (supervised) cannot relax any gate; the allow-only seed is what clears default-deny; the reset executor resolves credentials from the frozen original deploymentId, not the platform-direct context."

- [ ] Steps: failing test that the resolver predicate returns true for the reset intent; failing test that the handlers map contains the reset intent; wire all three; run `apps/api` + `db` tsc; commit `feat: register reset_prior_budget (platform-direct, allow-only, handler)`.

### Task 2.6: Governance-gate real-engine auto-execute test

**Files:** Create `apps/api/src/__tests__/riley-reset-budget-gate.test.ts` (mirror `riley-reallocate-gate.test.ts`).

Assert through the REAL GovernanceGate + policy engine: with the seeded allow-only policy, a `reset_prior_budget` submit resolves to EXECUTE (no park, no deny). Without the policy it default-denies. It is NOT on the financial denylist.

- [ ] Steps: write the test, run -> PASS, commit `test(api): reset_prior_budget auto-executes via allow-only gate`. Open PR-2, request review, fix Critical/Important, merge when green.

---

## PR-3: forward guardrail monitor cron + measurement provider (depends on PR-2)

### Task 3.1: Schema migration + store methods

**Files:** Modify `packages/db/prisma/schema.prisma` (MetaMutationAttempt); create migration `packages/db/prisma/migrations/<ts>_meta_mutation_attempt_guardrail/migration.sql`; Modify `packages/db/src/stores/prisma-meta-mutation-attempt-store.ts`; Tests in the store's `__tests__` (mocked Prisma).

Add columns `deploymentId String?` and `guardrailOutcome String?`. Migration SQL: `ALTER TABLE "MetaMutationAttempt" ADD COLUMN "deploymentId" TEXT, ADD COLUMN "guardrailOutcome" TEXT;` plus an index for the monitor query: `CREATE INDEX "MetaMutationAttempt_status_guardrailOutcome_updatedAt_idx" ON "MetaMutationAttempt"("status","guardrailOutcome","updatedAt");`. Update `db:generate`.

**Interfaces — Produces:** add `deploymentId?: string | null` to `CreateMetaMutationAttemptInput` + `ClaimLeaseAndMarkInput` (stamp it in `claimLeaseAndMark`'s create); new methods:

- `listOrgsWithPendingGuardrail(now: Date, minWindowMs: number): Promise<string[]>` -> distinct organizationIds where `status="applied" AND guardrailOutcome IS NULL AND updatedAt <= now - minWindowMs`.
- `listPendingGuardrailForOrg(orgId, now, minWindowMs): Promise<Array<{ executionWorkUnitId, organizationId, deploymentId, adAccountId, campaignId, observedPriorCents, workTraceId }>>` (same filter, scoped to org).
- `markGuardrailOutcome({ executionWorkUnitId, organizationId, outcome }): Promise<{ transitioned: boolean }>` -> `updateMany where executionWorkUnitId+organizationId+status="applied"+guardrailOutcome IS NULL data { guardrailOutcome: outcome }`; first-writer-wins.

- [ ] Steps: failing store tests (claim stamps deploymentId; list filters on window + null outcome; markGuardrailOutcome is first-writer-wins, count===0 second time) -> migration + schema + db:generate + implement -> pass -> tsc -> commit `feat(db): guardrail-monitoring columns + queries on MetaMutationAttempt`.

### Task 3.2: Forward executor stamps deploymentId

**Files:** Modify `apps/api/src/services/workflows/riley-budget-execution-workflow.ts` (pass `deploymentId` into `claimLeaseAndMark`); extend its test.

In step 7, add `deploymentId` to the `claimLeaseAndMark` call (the executor already has `deploymentId = workUnit.deployment.deploymentId`). Update the `attemptStore.claimLeaseAndMark` dep type in `RileyBudgetExecutionDeps` to accept `deploymentId`.

- [ ] Steps: extend the executor test to assert `claimLeaseAndMark` receives the deploymentId -> implement -> pass -> tsc -> commit `feat(api): stamp deploymentId on the reallocate lease for monitoring`.

### Task 3.3: Measurement provider

**Files:** Create `apps/api/src/services/cron/reallocation-guardrail-measurement.ts`; Test co-located.

**Interfaces — Consumes:** `PendingReallocation`, `GuardrailMeasurement` from `@switchboard/ad-optimizer`. **Produces:** `buildReallocationGuardrailMeasurement(deps): (r: PendingReallocation) => Promise<GuardrailMeasurement>` where deps = `{ getCampaignBudgetCents(deploymentId, campaignId): Promise<number|null>, getBookedCountForWindow({ orgId, startInclusive, endExclusive }): Promise<number|null>, now(): Date }`.

Logic per pending reallocation `r` (contract windowHours = max of `r.contract.guardrails[].windowHours`):

- `currentLiveCents` = `getCampaignBudgetCents(r.deploymentId, r.campaignId)`; null/throw -> still return a measurement but with `currentLiveCents: NaN` so `planReallocationRollback` returns null (unrestorable) AND omit both shares (unmeasured -> trips). Catch the throw; do not let it escape (the monitor's per-item try/catch is the backstop, but a clean measurement is better).
- post window booked = `getBookedCountForWindow(org, appliedAt, appliedAt+window)`; baseline booked = `getBookedCountForWindow(org, appliedAt-window, appliedAt)`. (appliedAt is not on `PendingReallocation`; pass it via the store row. ADD `appliedAt: Date` to `PendingReallocation`-shaped input by extending `listPendingGuardrailForOrg` to return `updatedAt` as `appliedAt`, and have the apps/api binding construct `PendingReallocation` with it. If extending the ad-optimizer `PendingReallocation` interface is cleaner, add `appliedAt: Date` there.)
- `account_booked_conversions_drop_share` = baseline reader threw/null -> OMIT (unmeasured). Else `baseline>0 ? max(0,(baseline-post)/baseline) : 0`.
- `freed_budget_absorbed_share`: `freedCents = max(0, r.observedPriorCents - currentLiveCents)`; v1 is increase-only so `freedCents === 0` -> share `0`. Guard `freed>0 ? absorbed/freed : 0` (absorbed measurement deferred with the decrease path; for v1 it is unreachable). If `currentLiveCents` is NaN, omit this share too.
- Return `{ shares: { ...measured }, currentLiveCents }`.

- [ ] Steps: failing tests (drop computed from pre/post; baseline 0 -> drop 0; baseline reader throws -> drop omitted; freed 0 -> absorbed 0; budget unreadable -> currentLiveCents NaN + both omitted) -> implement -> pass -> tsc -> commit `feat(api): reallocation guardrail measurement provider`.

### Task 3.4: dispatchRollback closure

**Files:** Create `apps/api/src/services/cron/reallocation-rollback-dispatch.ts`; Test co-located.

**Interfaces — Consumes:** `buildRileyResetBudgetSubmitRequest` (PR-2), `PlatformIngress.submit`. **Produces:** `buildReallocationRollbackDispatch(deps): ReallocationGuardrailMonitorDeps["dispatchRollback"]` where deps = `{ submitReset(req): Promise<SubmitWorkResponse>, log }`.

The closure builds the reset submit request from `(r, plan, breach)`: `{ organizationId: r.organizationId, deploymentId: r.deploymentId, adAccountId: r.adAccountId, campaignId: r.campaignId, targetCents: plan.targetCents, rollbackOfWorkUnitId: r.executionWorkUnitId... }` (the forward execution work unit id; ensure `PendingReallocation` carries it -- extend the ad-optimizer interface with `executionWorkUnitId: string`), `breachMetric: breach.metric, breachReason: breach.reason`, then `submitReset`. Branch on `"approvalRequired" in response` defensively even though the reset is allow-only (if a misconfig parks it, log a critical warning rather than silently believing the rollback happened).

- [ ] Steps: failing tests (submits the reset with targetCents + frozen fields; an approvalRequired response logs a critical warning) -> implement -> pass -> tsc -> commit `feat(api): governed reset_prior_budget rollback dispatch`.

### Task 3.5: Monitor dispatch + worker cron

**Files:** Create `apps/api/src/services/cron/riley-reallocation-guardrail-monitor.ts`; Test co-located. Add metric `rileyReallocationGuardrailOutcome` (Counter, labels `{orgId, outcome}`) to all three registries.

**Interfaces — Produces:** `createRileyReallocationGuardrailDispatch(deps, onFailure)` (mirrors `createRileyOutcomeAttributionDispatch`: lists orgs via `listOrgsWithPendingGuardrail`, emits one `riley.reallocation.guardrail-check` event per org); `createRileyReallocationGuardrailWorker(deps)` (Inngest function, `retries:2`, triggers `riley.reallocation.guardrail-check`, `onFailure` = critical alert via `makeOnFailureHandler` riskCategory `"high"` alert `true`); `executeRileyReallocationGuardrailWorker(deps, event)` (pure, unit-testable): resolve `orgId` from event, build the per-org deps, call `runReallocationGuardrailMonitor`. The worker's `ReallocationGuardrailMonitorDeps`:

- `listPendingReallocations` = `() => store.listPendingGuardrailForOrg(orgId, now, minWindowMs).then(map to PendingReallocation with contract=DEFAULT_BLAST_RADIUS_CONTRACT)`.
- `measureGuardrails` = the Task 3.3 provider.
- `dispatchRollback` = the Task 3.4 closure.
- `resolveReallocation` = `(r, outcome) => store.markGuardrailOutcome({...}).then(() => metrics.rileyReallocationGuardrailOutcome.inc({orgId, outcome}))`.
- `onMonitorFailure` = `(r, err) => safeAlert(operatorAlerter, { severity:"critical", ... })` (per-item isolation; the batch continues).

NO enable flag: the worker always runs its logic (it is inert when `listPendingReallocations` is empty). Document this in the worker header (safety-by-construction; it only ever rolls back a campaign that was reallocated, which requires the canary flag to have been on).

- [ ] Steps: failing tests for `executeRileyReallocationGuardrailWorker` (no pending -> no dispatch; a breaching measurement -> dispatchRollback called + outcome rolled_back recorded; an unrestorable -> critical alert + no dispatch; per-item failure isolates) -> implement -> pass -> tsc (api + chat + core for the metric) -> commit `feat(api): reallocation guardrail monitor dispatch + worker`.

### Task 3.6: Wire into bootstrap

**Files:** Modify `apps/api/src/bootstrap/inngest.ts` (construct the dispatch + worker beside the outcome-attribution block, reusing `bookedValueByCampaignStore` for booked counts and a `getCampaignBudgetCents` adapter over `MetaAdsClient`/the credential resolver; register both functions in the `serve` functions array). Reuse `createMetaInsightsProviderForOrg`'s credential-resolution pattern for the per-org budget read.

- [ ] Steps: add the wiring; `apps/api` tsc + build; run `apps/api` test for inngest registration if present; commit `feat(api): register the always-on reallocation guardrail monitor`. Open PR-3, review, merge.

---

## PR-4: in-flight kill-switch (independent of PR-2/3)

### Task 4.1: Executor last-mile kill check

**Files:** Modify `apps/api/src/services/workflows/riley-budget-execution-workflow.ts` + `apps/api/src/bootstrap/riley-budget-executor.ts`; extend tests.

Add a REQUIRED dep `isReallocateKilled: (args:{organizationId, deploymentId}) => Promise<boolean>` to `RileyBudgetExecutionDeps`. In `execute`, AFTER the replay-first block (step 2, so a replay still returns its receipt) and BEFORE credential resolution (step 3), check it; if true return `outcome:"failed"` code `RILEY_REALLOCATE_KILLED` summary "Reallocation halted by the runtime kill-switch" with NO marker written (clean abort, re-runnable when the switch clears). REQUIRED not optional (an optional dep recreates the hole). Bootstrap builds it from `governanceSettings.reallocateKillSwitch === true` on the deployment row (read via `PrismaDeploymentStore.findById`, org-scoped: a deployment whose org differs reads as killed=true, the safe direction).

- [ ] Steps: failing tests (killed -> RILEY_REALLOCATE_KILLED, no `claimLeaseAndMark` call, no Meta write; not killed -> proceeds; a replay of an applied unit still returns its receipt even when killed) -> implement -> pass -> tsc -> commit `feat(api): in-flight kill-switch check in the reallocate executor`.

### Task 4.2: DB setters (kill-switch + the missing canary)

**Files:** Create `packages/db/src/seed/riley-reallocate-flag-toggle.ts`; export from `index.ts`; Tests mocked-Prisma.

**Interfaces — Produces:** `setRileyReallocateKillSwitch(prisma, ledger, {organizationId, enabled, actor})` and `setRileyReallocateSelfExecution(prisma, ledger, {organizationId, enabled, actor})` -> both mirror `setRileyPauseSelfExecution` exactly (resolve ad-optimizer listing -> deployment, read-modify-write the specific governanceSettings key preserving others, write one chain-hashed `policy.updated` AuditLedger row, return `{previous, current}`). Keys: `reallocateKillSwitch` and `reallocateSelfExecutionEnabled`.

- [ ] Steps: failing tests (flip preserves other keys; writes an audit row; missing deployment throws) -> implement -> pass -> tsc -> commit `feat(db): audited setters for reallocate kill-switch + canary flag`.

### Task 4.3: Flip scripts

**Files:** Create `scripts/riley-reallocate-kill-switch.ts` and `scripts/riley-reallocate-flag.ts` (mirror `scripts/riley-pause-flag.ts`: parse `<orgId> --enable|--disable --actor <who>`, compose the real `AuditLedger` over `PrismaLedgerStorage`, call the setter, `console.warn` the transition).

- [ ] Steps: write both scripts; `pnpm exec tsc --noEmit` on the scripts tsconfig if one applies (else api/db tsc covers the imports); commit `feat(scripts): reallocate kill-switch + canary flip scripts`. Open PR-4, review, merge.

---

## PR-5: end-to-end staged exercise + runbook (depends on PR-2/3/4)

### Task 5.1: Staged integration test

**Files:** Create `apps/api/src/__tests__/riley-reallocate-act-leg-e2e.test.ts`.

Wire the REAL `runReallocationGuardrailMonitor` + the REAL reset executor (`buildRileyResetBudgetExecutionWorkflow`) + the REAL forward executor (`buildRileyBudgetExecutionWorkflow`) with fakes: an in-memory budget map as the "Meta" (fake `createAdsClient` reads/writes it), an in-memory attempt store, a fake measurement provider scripted to breach `account_booked_conversions_drop_share`, and a direct `dispatchRollback` that invokes the reset executor against the same in-memory budget. Assert the full chain:

1. Forward executor applies a +20% budget to the fake Meta (captures observedPriorCents).
2. Monitor measures (scripted breach) -> `evaluateBlastRadiusGuardrails` trips -> `planReallocationRollback` computes the restore -> reset executor sets the fake Meta budget back to observedPriorCents -> `markGuardrailOutcome("rolled_back")`.
3. Assert the fake Meta budget equals the original prior, the reset receipt is `campaign_budget_reset` with `rollbackOfWorkUnitId` = the forward unit, and the attempt row's guardrailOutcome is `rolled_back`.
4. Kill-switch leg: with `isReallocateKilled` true, the forward executor returns `RILEY_REALLOCATE_KILLED` and the fake Meta budget is unchanged + no attempt marker exists.

- [ ] Steps: write the test, run -> PASS (this is the runbook §4 staged proof), commit `test(api): staged breach -> rollback -> kill-switch act-leg exercise`.

### Task 5.2: Runbook update

**Files:** Modify `docs/runbooks/riley-reallocation-go-live.md`.

Flip §1-3 from "remaining" to WIRED + STAGED-exercised; update `BLAST_RADIUS_PROTECTIONS` prose references; state the precise residual: §4-live (live-Meta exercise), §5 (Tier-0 credentialed pilot), §6 (paid-value data). Update the "current safety state" and "HARD precondition" sections to reflect: forward monitor wired (always-on cron), governed reset dispatch wired (allow-only/platform-direct), runtime kill-switch wired (per-deployment, executor last-mile). Update `packages/ad-optimizer/src/blast-radius-contract.ts` `BLAST_RADIUS_PROTECTIONS` to `forwardGuardrails:"wired"`, `automatedRollback:"wired"` and the doc comment.

- [ ] Steps: edit the runbook + the protections marker + its test; `pnpm --filter @switchboard/ad-optimizer test blast-radius`; commit `docs(runbook): reallocate act-leg wired + staged-exercised; residual is live-only`. Open PR-5, review, merge. Tear down the worktree.

---

## Self-review

- **Spec coverage:** §1 forward monitor -> PR-3 (3.3/3.5/3.6). §2 governed rollback -> PR-2 (all) + PR-3 (3.4). §3 kill-switch -> PR-4. §4 exercise -> PR-5. Fork A -> 2.4/2.5. Fork B -> 3.5 (no-flag, own onFailure). Fork C -> 4.1/4.2. Schema -> 3.1. Receipt -> 2.1. All covered.
- **Type consistency:** `RILEY_RESET_PRIOR_BUDGET_INTENT`, `targetCents`, `rollbackOfWorkUnitId`, `breachMetric`/`breachReason`, `guardrailOutcome`, `deploymentId`, `isReallocateKilled`, `reallocateKillSwitch` used consistently across tasks. `PendingReallocation` extended with `executionWorkUnitId` + `appliedAt` (3.3/3.4/3.5 consume them) — the one cross-package interface change, made in PR-3.
- **Residual honesty:** the plan builds wiring + a STAGED exercise only; live-Meta exercise and the pilot/data preconditions stay operational and are stated as such in 5.2.
