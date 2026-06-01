# Spec — Make the stored autonomy spend threshold REAL

**Date:** 2026-06-01
**Status:** Design (for review)
**Branch:** `feat/autonomy-spend-threshold`
**Class:** SAFETY-CRITICAL governance change. PR-for-review, not merge.

## 1. Problem

`AgentDeployment.spendApprovalThreshold` (Prisma `Float @default(50)`) and
`AgentDeployment.trustLevel` are **stored but never enforced**. Any UI that
implies a per-agent spend boundary ("Riley adjusts budget up to $300, asks
above") is therefore a _safety illusion_ — the product's cardinal failure class
(`feedback_autonomy_fields_stored_not_enforced`,
`feedback_safety_gate_needs_producer_population`).

Verified against `main` (`0d828ff6`):

1. **The live gate ignores the threshold.** `GovernanceGate.evaluate`
   (`packages/core/src/platform/governance/governance-gate.ts:81`) reads only
   `workUnit.deployment?.trustLevelOverride` (default `"guided"`). It never reads
   any dollar amount or `spendApprovalThreshold`. Its decision is
   `toGovernanceDecision(trace, constraints)` with precedence
   **deny → require_approval → execute** (`decision-adapter.ts`).
2. **The value never reaches the gate (#644 footgun).** The live deployment
   builder `resolveAuthoritativeDeployment`
   (`apps/api/src/bootstrap/platform-deployment-resolver.ts:8`) threads
   `trustLevelOverride` but **drops `policyOverrides`** — which is where
   `spendApprovalThreshold` lives (`DeploymentPolicyOverrides`,
   `deployment-context.ts:13`). The core reference mapper `toDeploymentContext`
   already threads it; only the live (apps/api) mapper drops it.
3. **No producer feeds a spend amount through the gate.** `extractSpendAmount`
   (`packages/core/src/engine/spend-limits.ts:10`) reads
   `parameters.amount`/`budgetChange`. Riley's recommendations carry the dollar
   figure only in `estimatedImpact` (a display string) + a scraped
   `dollarsAtRisk`; the governed action they submit
   (`operator.act_on_recommendation`) carries only `{recommendationId, action,
note}`. So the amount is dropped before any gate sees it.

### Distinction that anchors the whole design

There are **two different spend concepts**, and we must not conflate them:

| Concept                                       | Field                                                   | Behaviour                                                         | Status    |
| --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- | --------- |
| Spend **limit** (hard ceiling)                | `IdentitySpec.effectiveSpendLimits.perAction/daily/...` | **DENY** when exceeded (policy-engine step 6, `checkSpendLimits`) | exists    |
| Spend **approval threshold** (autonomy lever) | `AgentDeployment.spendApprovalThreshold`                | **PARK not deny** — auto up to $X, ask above                      | this spec |

The limit is a deny-floor. The threshold is an _autonomy knob_. The threshold
must **never** override a deny produced by the limit (or by anything else).

## 2. Goal

Make `spendApprovalThreshold` a **real, enforced** gate mechanism that is
**OFF by default** and only relaxes approval for an explicitly-autonomous
deployment, on a reversible financial action whose amount is at or under the
threshold. Above the threshold it **parks** (require_approval). It **never**
turns a deny into anything else.

## 3. Design

Four wired parts, shipped as ONE PR (half-wired = safety illusion):

### 3.1 Spend-amount extractor (single canonical reader)

Extend the existing `extractSpendAmount(proposal)` in
`packages/core/src/engine/spend-limits.ts` to read, in order:

```
spendAmount → amount → budgetChange → newBudget
```

`spendAmount` is the new canonical key; the others are producer aliases.
Returns `null` when none is a finite number. One extractor, used by **both**
the existing spend-_limit_ check (step 6) and the new threshold logic — so they
can never disagree about what "the amount" is. (This also fixes a latent bug:
Alex budget actions that use `newBudget` were invisible to the spend-limit check
before.)

### 3.2 Thread `spendApprovalThreshold` to the gate (#644 fix)

`resolveAuthoritativeDeployment` adds `policyOverrides: result.policyOverrides`
to the `DeploymentContext` it returns. (`toDeploymentContext` already threads
it; this brings the live mapper to parity for `policyOverrides` only.) Scope
note: `persona`/`inputConfig` are also dropped by the live mapper — that is a
pre-existing #644 gap with different behavioural blast radius (prompt persona,
pilotMode) and is intentionally **out of scope** here; documented in the PR.

### 3.3 Gate logic — `applySpendApprovalThreshold`

A **pure** helper `packages/core/src/platform/governance/spend-approval-threshold.ts`,
applied in `GovernanceGate.evaluate` immediately after
`toGovernanceDecision(trace, constraints)`:

```
applySpendApprovalThreshold(decision, {
  trustLevelOverride,   // workUnit.deployment?.trustLevelOverride
  threshold,            // workUnit.deployment?.policyOverrides?.spendApprovalThreshold
  spendAmount,          // extractSpendAmount(proposal)
  mutationClass,        // registration.mutationClass
  reversibility,        // riskInput.reversibility
})
```

Rules (in order; any unmet guard ⇒ return `decision` **unchanged**):

1. `trustLevelOverride === "autonomous"` — else dormant. **This is the safe
   default**: every guided/supervised deployment is byte-identical to today.
2. `decision.outcome !== "deny"` — **never touch a deny** (forbidden behaviour,
   spend-limit exceeded, policy deny, irreversible-at-supervised deny all stand).
3. `threshold` is a finite number — else no threshold configured.
4. `spendAmount` is a finite number — else non-financial action; the threshold
   only governs spend.
5. Let `amount = |spendAmount|` and
   `isReversible = mutationClass !== "destructive" && reversibility !== "none"`.
6. If `amount <= threshold`:
   - `require_approval` **and** `approvalLevel === "standard"` **and**
     `isReversible` → **downgrade to execute** (the autonomy grant). Carry over
     riskScore/constraints/matchedPolicies; append a `"SPEND_APPROVAL_THRESHOLD"`
     marker to `matchedPolicies` for the audit trail. **Only the routine
     `"standard"` approval is relaxed** — `"elevated"` (high risk category) and
     `"mandatory"` (system-critical posture or a manual-approval gate) are stronger
     non-spend safety signals that the spend lever must never override; they stay
     parked even under threshold.
   - otherwise unchanged (irreversible / elevated / mandatory under threshold stays
     parked; an execute stays execute).
7. If `amount > threshold`:
   - `execute` → **escalate to require_approval** (`approvalLevel:"standard"`,
     the "asks above $X" guarantee; the safe direction). Marker appended.
   - otherwise unchanged (already parked).

The helper is total (defined for every base outcome) and **monotone in safety**:
the only relaxation is downgrading a _reversible financial **standard** approval
under threshold under autonomous_; everything else is a no-op or an escalation. A
deny is a fixed point.

**Schema-default note:** `spendApprovalThreshold` is `Float @default(50)`
(non-nullable), so once `policyOverrides` is threaded, every deployment carries
`threshold = 50` unless overridden. Combined with rule 1, an **autonomous**
deployment therefore auto-approves reversible financial standard-approval actions
**≤ $50** by default. This is the intended calibration (the schema default _is_
the grant) and is opt-in (requires `trustLevelOverride="autonomous"`, which no
production deployment currently sets). Operators tune the dollar grant per
deployment.

`evaluate`'s `system_auto_approved` short-circuit (top of the method) is
untouched — it is an explicit "skip approval lookup" path for operator-direct
intents and is not part of the agent-autonomy lane.

### 3.4 Producer-population (Riley) + honest boundary

The Riley recommendation-sink (`packages/ad-optimizer/src/recommendation-sink.ts`)
will inject the dollar figure as **structured** `parameters.spendAmount` (number)
for `financialEffect` actions, instead of leaving it trapped in the
`estimatedImpact` display string. So a recommendation now _carries_ its amount in
a field `extractSpendAmount` reads. The end-to-end test drives the gate from this
exact producer parameter shape (not a hand-built fixture) — per
`feedback_safety_gate_needs_producer_population`.

**Boundary flagged for review (not a hidden hole):** no _live_ autonomous-agent
spend-execution path submits these through the gate today — Riley's apply
(`operator.act_on_recommendation`) is human-initiated and only transitions
recommendation state; the `digital-ads` executor is an unregistered stub
(`registerCartridges()` is empty); the one amount-carrying gate action
(`operator.record_revenue`) is `system_auto_approved` and _records_ revenue
rather than spending. Therefore, **in production the threshold is dormant** until
(a) an org sets a deployment's `trustLevelOverride="autonomous"` **and** (b) an
autonomous-agent spend action reaches the gate. Dormant = today's full
approval-gating, so this **fails safe**. Wiring an autonomous-agent
spend-execution path (or gating `act_on_recommendation`) is a larger, separate
workstream deliberately **out of scope**; gating a human-initiated click by an
_autonomy_ threshold would itself be a new illusion and is avoided.

Net effect of this PR: the stored field becomes **enforced when active, wired to
the gate, fed a structured amount, and proven by tests** — no longer ignored —
while not fabricating autonomy that does not exist.

## 4. Safety invariants (must be test-pinned)

1. **Deny is untouchable.** For every combination of (autonomous, under/over
   threshold, reversible/irreversible, financial/not), a base `deny` stays
   `deny`. Spend-limit-exceeded deny + forbidden-behaviour deny both verified.
2. **Irreversible stays parked.** Autonomous + under-threshold + irreversible
   (`mutationClass:"destructive"` or `reversibility:"none"`) financial
   `require_approval` is **not** downgraded.
3. **Default is dormant.** Guided/supervised (or absent override) → no-op even
   with a threshold and a spend amount present. Byte-identical to today.
4. **Non-financial untouched.** Autonomous + no extractable amount → no-op.
5. **Deny-floor independence.** The banned-phrase, claim-classifier, and PDPA
   consent gates are skill-runtime `afterSkill` hooks
   (`deny-floor-trust-independence.test.ts`), structurally independent of the
   platform gate and of trust level. The new logic lives only in the platform
   `GovernanceGate` decision and cannot reach them; reinforced by test.
6. **#781 governance matrix stays green.** The locked, CI-blocking,
   offline `evals/governance-decision` suite tests the _skill-runtime_
   `getToolGovernanceDecision` matrix, which this PR does not touch — so it
   remains green by construction (`pnpm eval:governance`). This is the S1
   regression lock for governance changes.

## 5. Files

| File                                                                    | Change                                   |
| ----------------------------------------------------------------------- | ---------------------------------------- |
| `packages/core/src/engine/spend-limits.ts`                              | extend `extractSpendAmount`              |
| `packages/core/src/engine/__tests__/spend-limits.test.ts`               | **new** unit tests                       |
| `packages/core/src/platform/governance/spend-approval-threshold.ts`     | **new** pure helper                      |
| `packages/core/src/platform/__tests__/spend-approval-threshold.test.ts` | **new** unit tests                       |
| `packages/core/src/platform/governance/governance-gate.ts`              | call helper after `toGovernanceDecision` |
| `packages/core/src/platform/__tests__/governance-gate.test.ts`          | extend: e2e + invariants                 |
| `apps/api/src/bootstrap/platform-deployment-resolver.ts`                | thread `policyOverrides`                 |
| `apps/api/src/__tests__/platform-deployment-resolver.test.ts`           | assert threshold forwards                |
| `packages/ad-optimizer/src/recommendation-sink.ts`                      | populate `parameters.spendAmount`        |
| `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`       | assert populated                         |

## 6. Out of scope

- Wiring an autonomous-agent spend-execution path / gating
  `operator.act_on_recommendation`.
- Threading `persona`/`inputConfig` through the live mapper (separate #644 gap).
- Any UI surfacing of the now-enforced threshold.
- `digital-ads` cartridge registration.

## 7. Verification

`pnpm --filter @switchboard/core test`, `pnpm --filter @switchboard/api test`,
`pnpm --filter @switchboard/ad-optimizer test`, `pnpm eval:governance`,
`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, full `pnpm build`.
