# Riley reallocate act-leg: flip-readiness wiring (design)

**Status:** design. **Author:** Riley act-leg session, 2026-06-25.
**Goal:** make the per-org canary genuinely flip-ready by closing the three remaining HARD
preconditions in `docs/runbooks/riley-reallocation-go-live.md` §1-4. Build the wiring so
`RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` _could_ be flipped for ONE canary org. The act leg stays
DARK throughout; merging the wiring is safe because the submitter is still env-gated.

## North-star

Riley's moat is the ACTING loop: Riley autonomously reallocates ad budget under guardrails. The
DECISION layer (PRs #1267/1268/1270/1273/1274/1276) is on main. What remains is the SAFETY
integration that makes autonomous money-movement reversible and stoppable without a human in the
millisecond path: a forward monitor that measures the move's blast radius, an automated rollback that
restores the captured prior, and an in-flight kill-switch. An off-flag is not a safety boundary
(Knight Capital); these three are.

## Current state (re-verified against main `cdce15525`)

- **Pure decision layer (DONE).** `packages/ad-optimizer/src/reallocation-guardrail-monitor.ts`
  exports `evaluateBlastRadiusGuardrails` (fail-closed), `planReallocationRollback` (set-to-absolute
  restore math), and `runReallocationGuardrailMonitor(deps)` (measure -> evaluate -> roll back, per
  item try/catch). All injected-deps, Layer 2, unit-pinned. NOT wired to any cron; no real
  measurement provider; `dispatchRollback` unimplemented.
- **Executor (DONE).** `riley-budget-execution-workflow.ts` runs the read-modify-re-read on approval,
  captures `observedPriorCents` into the `MetaMutationAttempt` lease row, writes the receipt to
  `WorkTrace.executionOutputs`. No last-mile kill check.
- **Canary flag (DONE, partial).** `governanceSettings.reallocateSelfExecutionEnabled` is mapped in
  `inngest.ts` and gates the SUBMITTER per org. It has NO audited setter (only the pause flag has
  `setRileyPauseSelfExecution`); flipping it today is a raw DB edit.
- **Governance (DONE).** `seedRileyReallocatePolicies` seeds allow + require_approval(mandatory);
  `adoptimizer.campaign.reallocate` is on `FINANCIAL_AUTO_APPROVE_DENYLIST`.

Each of the four in-scope preconditions is genuinely unbuilt and buildable offline (the live-Meta
exercise is the only deferred piece, §4 below).

## The three forks (brainstormed; decided + recorded)

### Fork A: rollback governance (runbook §2)

**Tension.** An automated rollback is a money-move that must NOT need human approval (it is a safety
reversal to a value the system already captured and already had a human approve as the "from"). Yet
an auto-approved money intent conflicts with the D9-2 `FINANCIAL_AUTO_APPROVE_DENYLIST`, which exists
precisely so no money-move rides the `system_auto_approved` short-circuit.

**Key code fact.** `isFinancialIntent` (governance-gate.ts) blocks only the `system_auto_approved`
short-circuit. An **allow-only policy** path is a different mechanism: a seeded `allow` policy with NO
`require_approval` sibling resolves to "execute" without a human, and is unaffected by the denylist
(the runbook itself states "allow alone would EXECUTE the money move with no human"). Precedent:
`ROBIN_RECOVERY_RETRY_INTENT` auto-executes via an allow-only policy + PLATFORM_DIRECT entry.

**Decision.** A DISTINCT intent `adoptimizer.campaign.reset_prior_budget`, structurally bounded to
"restore a captured prior":

1. **Allow-only governance** (`seedRileyResetBudgetPolicies`: ONE allow policy, no require_approval).
   Auto-executes. NOT `system_auto_approved`, so the denylist is irrelevant; left OFF the denylist
   deliberately (a comment will say why: it must auto-execute, and the denylist only gates
   system_auto_approved, which this never uses).
2. **PLATFORM_DIRECT entry** (added to `PLATFORM_DIRECT_WORKFLOW_INTENTS`). The intent prefix
   `adoptimizer` derives skillSlug `adoptimizer`, which has no seeded deployment, so the strict
   lookup would throw `deployment_not_found` and ship it prod-inert. Resolving platform-direct is also
   the honest attribution: the PLATFORM is reversing Riley's move, not Riley deciding to move.
   platform-direct is supervised / trustScore 0 and cannot relax any mandatory gate, so this only
   gets the intent TO the (allow-only) gate.
3. **Handler registration** (handlers map + `intentRegistry.register` with `approvalPolicy:"none"`,
   `allowedTriggers:["internal"]`). All three or it is prod-inert (the recurring gotcha).

**Structural bound.** The reset submit freezes `{ organizationId, deploymentId, adAccountId,
campaignId, targetCents }` where `targetCents` is the `observedPriorCents` the executor persisted on
the forward move's `MetaMutationAttempt`. The reset executor sets the budget to EXACTLY `targetCents`
(absolute set), never an arbitrary value, and re-reads to confirm. It carries NO `spendAmount` (a
restore is not an outbound spend decision; omitting it also keeps the spend-threshold gate from
parking the safety reversal). Because the reset only ever restores a value that was the human-approved
"from", it cannot be abused as a general budget-mover even though it auto-executes.

**Credentials under platform-direct.** Because the work unit's `deployment.deploymentId` resolves to
`"platform-direct"`, the reset executor must NOT resolve credentials from the work unit's deployment
context. It resolves them from the FROZEN `deploymentId` in the parameters (the original
reallocation's deployment), with the same org-isolation check the forward executor uses (the
deployment row's organizationId must equal the work unit's).

### Fork B: the monitor's home (runbook §1)

**Options.** (A) a dedicated dispatch+worker cron; (B) fold the monitor into the existing
outcome-attribution worker.

**Decision: a dedicated dispatch+worker pair** (`riley-reallocation-guardrail-monitor.ts`),
co-located beside outcome-attribution and REUSING its measurement adapters
(`createMetaInsightsProviderForOrg` for the live budget read + account window;
`PrismaConversionRecordStore.getBookedStatsForOrgWindow` for booked conversions). Rationale:

- **Gating mismatch.** Outcome-attribution is gated behind `RILEY_OUTCOME_ATTRIBUTION_ENABLED` (a
  bake flag). The monitor is a SAFETY mechanism that must run whenever a reallocation can be applied,
  independent of the attribution bake. Coupling them would tie the safety net to the wrong flag.
- **No enable flag at all (safe-by-construction).** The monitor is ALWAYS registered and always runs.
  It is inert without applied reallocations: `listPendingReallocations` returns `[]` when no org has
  self-executed, so a daily pass over zero rows is a no-op. A safety monitor must never be accidentally
  off, and it only ever dispatches a rollback for a campaign that was reallocated, which only happens
  when the canary flag was on for that org. So the monitor follows the reallocate lifecycle WITHOUT
  its own flag, and there is no "flag on but monitor off" hole.
- **Single responsibility + failure contract.** Its own `onFailure` (DOCTRINE inv 7): a monitor that
  cannot run is a safety failure, so it raises a **critical** OperatorAlerter alert (mirrors the
  weekly-audit `onDeploymentFailure`), plus the standard audit row. Per-item try/catch isolates one
  org's failure from the fleet (the `runReallocationGuardrailMonitor` contract already does this via
  `onMonitorFailure`).

**Cadence.** Daily, like outcome-attribution. A 72h contract window checked daily catches a breach
within a day of the window closing, which is well inside the rollback's value (an over-budget campaign
caught 24h late has still been reverted).

### Fork C: the kill-switch mechanism (runbook §3)

**Requirement.** A runtime stop that halts BOTH in-flight and future self-execution, distinct from the
env flag (which on Vercel needs a redeploy) and from the canary flag (which only gates the SUBMITTER,
so an already-approved-and-dispatched unit still executes).

**Decision: a per-deployment, runtime-flippable `governanceSettings.reallocateKillSwitch`**, read by
the EXECUTOR at the last mile (immediately before claiming the lease and the Meta write). When set,
the executor aborts with a distinct `RILEY_REALLOCATE_KILLED` reason BEFORE writing the durable lease
marker, so a clean abort leaves nothing to reconcile and the unit can re-run if the switch is later
cleared. This halts:

- **in-flight**: a dispatched, executing unit re-reads the switch right before its write and aborts;
- **future**: every subsequent execution aborts at the same gate until the switch clears.

It is runtime (a DB field flip, no redeploy) via an audited setter `setRileyReallocateKillSwitch`
(mirrors `setRileyPauseSelfExecution`: read-modify-write preserving other governanceSettings keys + one
chain-hashed AuditLedger `policy.updated` row) and a flip script
`scripts/riley-reallocate-kill-switch.ts`. The env flag remains the global static kill; this is the
granular runtime kill the canary needs. While here, add the missing audited canary setter
`setRileyReallocateSelfExecution` + `scripts/riley-reallocate-flag.ts` (the canary flag should not be a
raw DB edit before a real-money pilot).

## Architecture (component view)

```
                          daily cron (always on)
  riley-reallocation-guardrail-monitor-dispatch
      | lists orgs with applied, un-monitored reallocations
      v  one event per org
  riley-reallocation-guardrail-monitor-worker  (per org, retries=2, onFailure=critical)
      |  runReallocationGuardrailMonitor(deps):
      |    listPendingReallocations  <- MetaMutationAttempt (status=applied, guardrailOutcome=null,
      |                                  window elapsed) + frozen deploymentId
      |    measureGuardrails         <- buildReallocationGuardrailMeasurement (NEW provider):
      |                                  - account_booked_conversions_drop_share <- CRM window stats
      |                                    (post window vs equal-length pre baseline)
      |                                  - freed_budget_absorbed_share = 0 for an increase (freed=0)
      |                                  - currentLiveCents <- MetaAdsClient.getCampaign
      |    evaluate -> breach?
      |      no  -> resolveReallocation("held")        [sets guardrailOutcome]
      |      yes -> dispatchRollback -> PlatformIngress.submit(reset_prior_budget)
      |             resolveReallocation("rolled_back")
      v
  reset_prior_budget executor (allow-only, PLATFORM_DIRECT, internal trigger)
      set budget = targetCents (the captured prior); re-read; reset receipt
```

### Schema (PR-3)

Add to `MetaMutationAttempt` (one migration; both nullable, no hot-path risk):

- `deploymentId String?` -- the executor stamps `workUnit.deployment.deploymentId` at claim time so
  the monitor can resolve credentials and attribute the rollback. Nullable for the (nonexistent in
  prod, since the leg is dark) legacy rows.
- `guardrailOutcome String?` -- NULL = not yet monitored; set to the `ReallocationMonitorOutcome`
  (`held` | `rolled_back` | `rollback_noop` | `rollback_unrestorable`) once a pass resolves it.
  First-writer-wins via `updateMany ... where guardrailOutcome IS NULL`.

`listPendingReallocations` query: `status="applied" AND guardrailOutcome IS NULL AND updatedAt <= now -
maxWindowHours`. For an applied, un-monitored row, `updatedAt` is the `markApplied` time (applied is
terminal until the monitor sets `guardrailOutcome`), so it is a sound apply-time proxy; documented as
an invariant. The reset executor writes NO `MetaMutationAttempt` (it relies on ingress idempotency +
the idempotent absolute-set), so reset rows never enter the monitor's queue and there is no monitor
recursion.

### Reset receipt (PR-2)

Extend `ExecutionReceiptSchema` to a discriminated union on `kind`, adding
`campaign_budget_reset` with the same money fields plus `rollbackOfWorkUnitId` (the forward
reallocation's execution work unit) and `breachMetric` / `breachReason` (why the rollback fired). The
existing `campaign_budget_reallocation` variant is unchanged.

## Error handling (fail-closed throughout)

- **Unmeasured guardrail trips.** The measurement provider OMITS a metric it could not read (CRM store
  threw, Meta budget unreadable). `evaluateBlastRadiusGuardrails` already trips on an
  absent/non-finite reading. A money monitor cannot "pass" what it could not measure.
- **Unrestorable prior alarms.** If `currentLiveCents` is unreadable or `observedPriorCents` is
  non-finite/non-positive, `planReallocationRollback` returns null -> outcome `rollback_unrestorable`
  -> the worker raises a critical alert (a real breach went un-rolled-back).
- **Idempotent rollback.** The reset is an absolute set to `targetCents`; the dispatch idempotency key
  is `reset:<forwardWorkUnitId>`, so a re-dispatch (e.g. a `resolveReallocation` write failed and the
  row is re-picked next pass) is deduped at ingress and, even if it executed twice, sets the same
  value.
- **Kill-switch is a clean abort.** Checked before the lease, so a killed unit leaves no marker and is
  re-runnable; a genuine ungated execution path is impossible because the check is unconditional.
- **div-by-zero guards.** `freed_budget_absorbed_share = freed>0 ? absorbed/freed : 0`;
  `drop_share = baseline>0 ? max(0,(baseline-post)/baseline) : 0`. "Measured zero" (reader returned 0)
  is distinct from "could not measure" (reader threw -> metric omitted -> trips).

## Testing strategy

- **Unit (per package, mocked Prisma).** Reset executor (absolute-set, org-isolation under
  platform-direct, replay/idempotency, kill-switch abort). Measurement provider (drop computed from
  pre/post windows; freed=0 for increase; reader-throw -> omitted metric; Meta-unreadable ->
  unrestorable). Store query + `markGuardrailOutcome` first-writer-wins. Governance seed (allow-only,
  anchored regex). Setter + audit row.
- **Governance gate (real engine).** `reset_prior_budget` clears default-deny via the allow-only
  policy and AUTO-EXECUTES (no park), mirroring `riley-reallocate-gate.test.ts`.
- **End-to-end staged exercise (PR-5).** One test wires the REAL `runReallocationGuardrailMonitor`,
  the REAL reset executor, an in-memory ingress, a fake Meta client, and a fake measurement provider
  scripted to a breach. Asserts: monitor trips -> reset dispatched through ingress -> fake Meta budget
  restored to the captured prior -> `guardrailOutcome="rolled_back"` -> with the kill-switch set, the
  forward executor aborts `RILEY_REALLOCATE_KILLED` and never writes. This is the staged proof the
  runbook §4 requires; the live-Meta exercise stays operational/deferred.

## What stays DARK + residual after this work

- `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` stays OFF. The submitter stays env-gated; nothing in this
  work emits a forward reallocation.
- Residual to a real one-org canary flip (cannot be built without a live account): a Tier-0
  credentialed pilot org (§5), the count-vs-value gate having real campaign-attributed paid data
  (§6), and the single LIVE-Meta exercise (§4's live half). After this work, §1-4 are wired and
  STAGED-exercised; §4-live + §5 + §6 remain operational.

## PR breakdown

1. **docs** (this spec + the plan) -> main.
2. **PR-2** reset_prior_budget dispatch path (intent, allow-only seed, PLATFORM_DIRECT, executor,
   receipt). The DISPATCH target, mergeable alone (nothing calls it yet).
3. **PR-3** forward monitor cron + measurement provider + schema migration; `dispatchRollback` wired
   to PR-2's reset. Depends on PR-2.
4. **PR-4** in-flight kill-switch (executor last-mile check, field, setter, scripts). Independent.
5. **PR-5** end-to-end staged exercise + runbook update. Depends on PR-2/3/4.
