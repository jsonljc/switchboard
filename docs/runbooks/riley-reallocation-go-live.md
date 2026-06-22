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
- **NOT wired (forward interface, zero consumer):** the contract `guardrails`
  (`account_booked_conversions_drop_share`, `freed_budget_absorbed_share`) and the
  `reset_prior_budget` rollback (`BLAST_RADIUS_PROTECTIONS` in
  `packages/ad-optimizer/src/blast-radius-contract.ts`). No code reads them today.
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

1. The forward guardrail-evaluation monitor is WIRED (it reads `BlastRadiusContract.guardrails`
   over a real window and trips on a breach).
2. Automated rollback is WIRED (it executes `reset_prior_budget` from the persisted
   `observedPriorCents` on a tripped guardrail).
3. A genuine kill-switch exists (a runtime stop that halts in-flight and future self-execution, not
   merely the env flag).
4. All three have been EXERCISED end-to-end at least once (a real or staged breach tripped the
   monitor, the rollback restored the prior budget, the kill-switch halted execution). An
   unexercised rollback is assumed broken; an off-flag is not a safety boundary (Knight Capital).
5. A Tier-0 credentialed pilot org is provisioned (the executor needs live meta-ads credentials).
6. The count-vs-value gate (A12) has DATA: the pilot org records campaign-attributed verified
   payments, so the paid-value floor can pass a genuinely-paying campaign. Confirm on the real org
   that at least one scaling-candidate campaign resolves a finite positive paid value (watch the
   `scale_unproven_paid_value` watch clear for a paying campaign). Without this, the floor abstains by
   holding every scale as a watch: safe, but the reallocation feature stays dark even with the flag on.

Until 1-6 hold, `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` stays OFF. Wiring 1-4 is explicitly out
of scope for the contract-honesty slice (deferred per decision D3; NIST AI RMF staged autonomy). A6
(honest blast-radius contract + cap telemetry) and A12 (this count-vs-value gate) are the two code
prerequisites that are now COMPLETE; the remaining preconditions are operational.
