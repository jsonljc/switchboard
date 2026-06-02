# Mira P2a-iii — Make the creative spend-approval threshold REAL

**Date:** 2026-06-02
**Slice:** Mira P2 publish seam, P2a-iii
**Status:** design approved (enforcement = reuse #788 autonomy lever)
**Builds on:** #788 (`applySpendApprovalThreshold`), #810 (P2a-ii — creative-pipeline routes through `PlatformIngress`)

## Problem

`creative.job.submit/continue/stop` are registered `approvalPolicy:"threshold"`, but the
threshold is a **safety illusion**: no spend signal is ever surfaced for these
workflow-mode intents, so an expensive render never parks for approval — it
silently executes.

## Grounded model (verified against origin/main — corrects the prompt's assumptions)

1. **`approvalPolicy` is decorative.** `policy-engine.ts` never reads
   `metadata.approvalPolicy` or `budgetClass`. The approval requirement comes from
   **risk score → category → `resolvedIdentity.effectiveRiskTolerance`**, then a
   post-processor (`applySpendApprovalThreshold`, #788).
2. **The risk-scorer is the wrong instrument.** `dollarsAtRisk` contributes
   `min(20, (cost/$10,000)·20)` (`risk-scorer.ts:47,81`). Render costs are ~$1–15
   (`cost-estimator.ts`), so a $2 and a $200 render both score ~15 ("none").
   Surfacing `dollarsAtRisk` into the risk input would not move the decision.
3. **The real lever is #788.** `applySpendApprovalThreshold` compares
   `extractSpendAmount(proposal.parameters)` (keys `spendAmount|amount|budgetChange|newBudget`)
   to `deployment.policyOverrides.spendApprovalThreshold` and **escalates
   `execute → require_approval` above threshold** — but only when the deployment is
   `trustLevelOverride:"autonomous"` AND `spendAutonomyEnabled:true`. It relaxes a
   reversible standard approval under threshold the same way (auto-proceed). It
   never touches a `deny`, `elevated`, or `mandatory`.
4. **Deployment resolution.** `creative.job.*` → `skillSlug = intent.split(".")[0]`
   = `"creative"` → resolves the seeded `skillSlug:"creative"` deployment
   (`seed-mira-creative-deployment.ts`). The resolver forwards `trustLevelOverride`,
   `policyOverrides.spendApprovalThreshold`, and `spendAutonomyEnabled`
   (`platform-deployment-resolver.ts`). The seeded deployment has **no
   `governanceSettings`** today, so the lever is **dormant** for it.
5. **Spend commit point.** `creative.job.continue` at `currentStage:"storyboard"`
   with a `productionTier` (`creative-job-decision-workflow.ts:39`) is where the
   paid render fires AND where `estimateCost(storyboard, scriptCount)` is computable.
   Submit only enqueues cheap storyboard generation (no storyboard yet → no cost).
6. **Latent risk.** Only `org_dev` is seeded with policies; real/pilot orgs get
   none and the engine **default-denies** writes with no matching allow policy. The
   #810 route tests use a **spy ingress**, so the real gate was never exercised for
   `creative.job`. Step 1 below pins the live base decision.

## Decision

**Reuse the #788 autonomy lever** (chosen over a posture-independent "safety floor"
that would modify shipped governance). The cap engages because the creative
deployment is explicitly autonomous + spend-autonomy-opted-in — an honest,
_enforced_ posture statement aligned with the Mira "graduated autonomy + enforced
spend caps" vision. No change to `applySpendApprovalThreshold`.

## Design

### A. Render-cost producer (the missing piece)

At `creative.job.continue`, `apps/api/src/routes/creative-pipeline.ts` loads the job

- storyboard, computes `renderCost = estimateCost(storyboard, scriptCount)[tier].cost`
  **server-side**, and adds `spendAmount: renderCost` to the submit parameters. The
  operator chooses `productionTier` but cannot spoof the cost (derived from the
  persisted storyboard). `extractSpendAmount` then sees it.

* Tier defaults to `"basic"` when omitted (mirrors the workflow's
  `input.productionTier ?? "basic"`).
* If the storyboard is absent (continue arriving before storyboard) or
  `estimateCost` yields 0, `spendAmount` is omitted → lever no-op → unchanged
  behavior (fail-open to _today's_ behavior is acceptable: no storyboard ⇒ no paid
  render is imminent at this exact call; the gate re-applies on the real
  storyboard→render continue).

### B. Deployment posture (activates the lever)

`seed-mira-creative-deployment.ts` seeds `governanceSettings: { trustLevelOverride:
"autonomous", spendAutonomy: true }` AND an explicit `spendApprovalThreshold`
(`CREATIVE_SPEND_APPROVAL_THRESHOLD = $15`, in `creative-governance.ts`). The
non-nullable column default ($50) sits ABOVE realistic render costs (~$1–21, since
estimateCost is Kling $0.35–0.70/scene × ≤6 scenes × ≤5 scripts), so leaving it would
keep the gate dormant in practice — every render would auto-run. The creative-scaled
$15 lets a large/long multi-script batch park while a small clip auto-runs; tunable
per pilot. **Enablement caveat:** this is the per-org install function's config; the
dev seed runs it for `org_dev`. Wiring it into the pilot opt-in path
(`seedMiraPilotOrgs` only flips enablement today) is the separate, pending Mira
pilot-enablement workstream — until then a pilot org needs
`seedMiraCreativeDeployment(org)` run explicitly, or `creative.job.*` default-denies.

### C. Enforcement (unchanged #788 lever)

`renderCost > threshold` → `execute → require_approval` → ingress returns
`approvalRequired` → route returns `202 PENDING_APPROVAL` (already wired in #810).
`renderCost ≤ threshold` → executes (renders).

### D. Dashboard consumes 202

The dashboard creative-jobs proxies + `useApproveStage`/`submitCreativeBrief` +
`use-creative-pipeline.ts` must treat a `202 {outcome:"PENDING_APPROVAL"}` as a
distinct **pending-approval** state, not a generic error.

### E. In-scope cleanups

- **Fold `mira-brief.ts` onto `creative.job.submit`** (it still fires
  `creative-pipeline/job.submitted` directly — a live spend bypass). Same pattern as
  P2a-ii: front door + authenticated actor + governed intent; remove from
  `.agent/tools/route-allowlist.yaml`. (Likely its own focused PR.)
- **Branch the decision-workflow stop-path by `job.mode`**: `stop` → `jobStore.stop`
  for polished, `jobStore.stopUgc` for ugc (mirrors how the Inngest event already
  branches). Benign today, but correct.

## Test strategy (TDD, real-gate)

1. **Characterization (red→known):** a real-`GovernanceGate` test (mirroring
   `governance-gate.test.ts` / `test-server.ts`) that pins `creative.job.continue`'s
   base decision for an autonomous creative deployment. Settles execute-vs-deny and
   the allow-path question.
2. **Producer:** route test — continue includes `spendAmount` computed from
   `estimateCost(storyboard, tier)`; tier default; storyboard-absent omits it.
3. **Enforcement (the anti-illusion test):** through the **real** gate +
   **real** `applySpendApprovalThreshold` + **real** `extractSpendAmount`:
   an autonomous+opted-in creative deployment with `renderCost > threshold` →
   `require_approval` (+ `SPEND_APPROVAL_THRESHOLD` marker); `≤ threshold` →
   `execute`. Driven from the **real seeded deployment defaults**, not a hand-built
   fixture (per `feedback_safety_gate_needs_producer_population`).
4. **Route 202:** continue with an approval-required ingress response → `202
PENDING_APPROVAL`, never a phantom 200 (extends the existing #810 test).
5. **Dashboard:** pending-approval rendering path.
6. **Cleanups:** mira-brief reroute (front door + actor + no direct inngest);
   stop-path mode branch.

## PR plan

- **PR 1 (core P2a-iii):** producer + seed posture + real-gate enforcement +
  dashboard 202 + decision-workflow stop-path branch.
- **PR 2 (mira-brief fold):** reroute `mira-brief.ts` onto `creative.job.submit`,
  remove from route-allowlist.

## Risks / watchouts

- Declaring the creative deployment `autonomous` must not leak into UI as an
  over-claim — verify no agent-panel/trust surface reads the `creative` deployment's
  `trustLevelOverride` and renders an unbounded "autonomous" claim. The enforced
  truth is "auto-renders within an enforced cap; parks above it."
- The `creative` deployment is a pipeline, not a tool-calling skill, so autonomous
  `constraints.trustLevel` has no skill-admission side effect to verify — but confirm
  there is no `creative` skill manifest with external_mutation tools.
- Reversibility brake: render spend is reversible (`mutationClass:"write"`,
  default `reversibility:"full"`), so the lever can relax under threshold — correct
  for "auto-proceed cheap renders".
