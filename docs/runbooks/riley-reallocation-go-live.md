# Riley budget-reallocation self-execution: go-live gate

**Type:** Operational gate. Records the HARD precondition for flipping
`RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` (Riley's first autonomous real-money mover) and the
current honest safety state. **Default: OFF (dark).**

## What flipping the flag does

`RILEY_REALLOCATE_SELF_EXECUTION_ENABLED=true` wires the reallocate SUBMITTER
(`apps/api/src/bootstrap/inngest.ts`), letting Riley emit `adoptimizer.campaign.reallocate` into
PlatformIngress. Every move still parks on the seeded `require_approval(mandatory)` policy and is
on the D9-2 financial auto-approve denylist, so a human approves each one. The executor
(`apps/api/src/services/workflows/riley-budget-execution-workflow.ts`) then runs the
read-modify-re-read sequence.

## Scope: BUDGET-INCREASE-ONLY (v1)

v1 only scales budgets UP (`REALLOCATE_SCALE_FACTOR = 1.2`, a +20% increase). Decreases
(`review_budget`) are deferred. Operator-facing copy says "increase budget", not the ambiguous
"scale budget": the agent-home tile verb and the recommendation card headline both reflect this.

## Current safety state (honest, as of this runbook)

- **Active:** the executor's pre-write cap `assertWithinBlastRadius` (the ONLY wired blast-radius
  protection): a per-move dollar ceiling (`maxDeltaCents`, $50 default) plus an account-spend share
  ceiling (`maxAccountSpendShare`, 0.25), fail-closed on a non-finite delta or an unsizable account
  spend.
- **WIRED + staged-exercised:** the forward guardrail-evaluation monitor AND the automated
  `reset_prior_budget` rollback now run end-to-end. A daily, always-on dispatch+worker cron
  (`riley-reallocation-guardrail-monitor.ts`) runs `runReallocationGuardrailMonitor` per org with a
  REAL measurement provider (`reallocation-guardrail-measurement.ts`: account-level CRM
  booked-conversion drop over the contract window + the live campaign budget); on a breach it
  dispatches the governed `reset_prior_budget` intent through PlatformIngress (allow-only +
  PLATFORM_DIRECT + handler), which restores the captured prior. Fail-closed throughout (an
  unmeasurable guardrail trips; a failed/parked reset is NOT marked rolled-back). Staged-exercised
  end-to-end in `apps/api/src/__tests__/riley-reallocate-act-leg-e2e.test.ts`. The monitor is inert
  while the act-leg is dark (no applied reallocations to evaluate).
- **In-flight kill-switch (`governanceSettings.reallocateKillSwitch`):** the reallocate EXECUTOR
  reads it at the last mile (after replay-first, before credentials + the Meta write) and aborts with
  `RILEY_REALLOCATE_KILLED` and no marker. It halts every execution not yet past the last-mile check
  (nothing new starts its Meta sequence) plus all future executions, at runtime (a DB flip, no
  redeploy). Flip via the audited `scripts/riley-reallocate-kill-switch.ts`.
- **Per-deployment CANARY flag:** `governanceSettings.reallocateSelfExecutionEnabled` gates the
  reallocate submitter per org (mirrors `pauseSelfExecutionEnabled`), so the env flip reaches ONE
  canary org instead of every org's runner at once. Both the env kill switch and the per-org flag
  must be on. Flip via the audited `scripts/riley-reallocate-flag.ts` (it previously had no audited
  setter). Distinct from the kill-switch: the canary gates the SUBMITTER (future proposals), the
  kill-switch gates the EXECUTOR (in-flight + future).
- **Observability:** `switchboard_riley_reallocation_cap_evaluated_total{orgId,outcome}` (outcome =
  within_cap | delta_cap | share_cap) fires once per cap evaluation INSIDE the executor, so it is
  observable the moment the executor runs. It shares the flag-gated executor's reachability: it is
  NOT observable while the flag is off. For pre-flip preview, run the shadow harness
  (`buildShadowReallocationReport`), which reports the `blastRadiusRejected` count without moving
  money.

## Count-vs-value gate (A12) and the paid-value data dependency

Riley's `scale` -> reallocate money-move is gated on PROVEN paid value: a `scale` rec only becomes a
reallocation candidate when the campaign has finite, positive, campaign-attributed verified-paid
value (the per-campaign sum of `type:"purchased"` ConversionRecord value). When paid value is absent,
non-finite, or zero, the rec is demoted to a `scale_unproven_paid_value` watch (fail-closed; it
surfaces and recovers as receipts populate). The advisory is never silently dropped. The gate lives in
`decideForCampaign` (the earliest point in the scale -> reallocate transition) and is fed by
`PrismaConversionRecordStore.queryPaidValueCentsByCampaign`, wired as `paidValueByCampaignProvider` in
`apps/api/src/bootstrap/inngest.ts`. It is independent of the self-execution flag: the floor is live
whenever the weekly audit runs, so it already shapes the parked-for-approval proposals today.

Paid value is produced ONLY by verified payments that carry campaign attribution (the
`record-verified-payment` / revenue operator intents write `type:"purchased"` ConversionRecords with
the real paid amount and `sourceCampaignId`; the record-store defaults `origin` to `"live"`, which the
floor query requires, so a future producer writing `origin:"seed"`/`"demo"` would correctly NOT satisfy
the floor). Until an org records campaign-attributed verified payments, every `scale` for that org
surfaces as a `scale_unproven_paid_value` watch rather than a budget-increase money-move. This is the
intended fail-closed default, not a bug: the gate never fabricates a pass on missing data.

## HARD precondition before flipping the flag (do NOT flip until ALL are true)

1. The forward guardrail-evaluation monitor is WIRED **end-to-end**. ✅ DONE: the always-on daily
   `riley-reallocation-guardrail-monitor` cron runs `runReallocationGuardrailMonitor` per org with a
   real Meta-window + CRM measurement provider.
2. Automated rollback is WIRED **end-to-end**. ✅ DONE: on a breach the monitor dispatches the
   governed `reset_prior_budget` intent (allow-only + PLATFORM_DIRECT + handler) through ingress,
   restoring the captured prior; the executor enforces `targetCents == observedPriorCents` so it can
   only ever restore the captured prior.
3. A genuine in-flight kill-switch exists (a runtime stop, not merely the env flag). ✅ DONE:
   `governanceSettings.reallocateKillSwitch`, read by the executor at the last mile (see the safety
   state above for the precise scope).
4. The chain has been EXERCISED end-to-end at least once. ✅ STAGED (live half remaining): the staged
   exercise (`riley-reallocate-act-leg-e2e.test.ts`) drives a simulated breach → monitor trip →
   reset restores the prior → kill-switch halt, against in-memory fakes. The single **LIVE-Meta**
   exercise on a credentialed org remains operational (an unexercised-against-real-Meta rollback is
   assumed broken; an off-flag is not a safety boundary — Knight Capital).
5. A Tier-0 credentialed pilot org is provisioned (the executor needs live meta-ads credentials).
   ⏳ Operational.
6. The count-vs-value gate (A12) has DATA: the pilot org records campaign-attributed verified
   payments, so the paid-value floor can pass a genuinely-paying campaign. Confirm on the real org
   that at least one scaling-candidate campaign resolves a finite positive paid value (watch the
   `scale_unproven_paid_value` watch clear for a paying campaign). Without this, the floor abstains by
   holding every scale as a watch: safe, but the reallocation feature stays dark even with the flag on.
   ⏳ Operational.

Until 1-6 hold, `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` stays OFF. The CODE preconditions 1-3 are
COMPLETE and 4 is STAGED-exercised; the residual is OPERATIONAL and cannot be built without a live
account: the single live-Meta exercise (4's live half), a Tier-0 credentialed pilot org (5), and
real campaign-attributed paid-value data (6). Staged autonomy (NIST AI RMF): the canary makes a
single-org supervised pilot gateable once the live exercise (4) is done on the pilot org; a global
flip still waits on all of 1-6.
