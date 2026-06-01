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
can never disagree about what "the amount" is.

**Cross-cutting side effect (safe direction, applies to ALL deployments):**
because this same extractor feeds the spend-_limit_ DENY check
(`policy-engine.ts` step 6), widening it means actions that key their amount under
`spendAmount`/`newBudget` are now subject to the per-action/daily/weekly/monthly
spend-limit deny too (previously they read as `null` and escaped it). This is a
tightening (fixes a latent gap where e.g. Alex `newBudget` actions bypassed spend
limits) and is independent of the opt-in lever — it applies wherever an
`effectiveSpendLimits` identity is loaded. The `Number.isFinite` guard also
hardens the limit path against `NaN`/`Infinity`.

### 3.2 Thread `spendApprovalThreshold` + an explicit opt-in to the gate (#644 fix)

`resolveAuthoritativeDeployment` adds `policyOverrides: result.policyOverrides`
to the `DeploymentContext` it returns (the threshold _value_). (`toDeploymentContext`
already threads it; this brings the live mapper to parity for `policyOverrides`.)
Scope note: `persona`/`inputConfig` are also dropped by the live mapper — a
pre-existing #644 gap with different blast radius (prompt persona, pilotMode),
intentionally **out of scope** here.

**Explicit opt-in (critical safety design).** `spendApprovalThreshold` is a
non-nullable Prisma column (`Float @default(50)`), so `policyOverrides.spendApprovalThreshold`
is **always populated at $50** for any real deployment. The bare presence of a
threshold therefore CANNOT mean "the operator chose this boundary" — and the seed
already ships Alex/Riley as `trustLevelOverride:"autonomous"`. Relying on
"autonomous + threshold present" would make the $50 default an **unchosen**
auto-execute boundary the instant a spend producer reaches the gate. So the lever
requires a **separate, explicitly-set** signal: `governanceSettings.spendAutonomy === true`
(resolved by `resolveSpendAutonomyEnabled`, threaded as `DeploymentContext.spendAutonomyEnabled`,
mirroring `trustLevelOverride`). The column supplies the dollar _value_; this flag
supplies _activation_. Defaults `false` ⇒ dormant. Seeded-autonomous deployments
stay dormant until an operator deliberately opts in.

### 3.3 Gate logic — `applySpendApprovalThreshold`

A **pure** helper `packages/core/src/platform/governance/spend-approval-threshold.ts`,
applied in `GovernanceGate.evaluate` immediately after
`toGovernanceDecision(trace, constraints)`:

```
applySpendApprovalThreshold(decision, {
  trustLevelOverride,    // workUnit.deployment?.trustLevelOverride
  spendAutonomyEnabled,  // workUnit.deployment?.spendAutonomyEnabled (explicit opt-in)
  threshold,             // workUnit.deployment?.policyOverrides?.spendApprovalThreshold
  spendAmount,           // extractSpendAmount(proposal)
  mutationClass,         // registration.mutationClass
  reversibility,         // riskInput.reversibility
})
```

Rules (in order; any unmet guard ⇒ return `decision` **unchanged**):

1. `trustLevelOverride === "autonomous"` — else dormant. **Safe default**: every
   guided/supervised deployment is byte-identical to today.
   1b. `spendAutonomyEnabled === true` — the explicit per-deployment opt-in (§3.2).
   Else dormant, even for an autonomous deployment carrying the $50 column default.
2. `decision.outcome !== "deny"` — **never touch a deny** (forbidden behaviour,
   spend-limit exceeded, policy deny, irreversible-at-supervised deny all stand).
3. `threshold` is a finite number — else no threshold configured.
4. `spendAmount` is a finite number — else non-financial action; the threshold
   only governs spend.
5. Let `amount = |spendAmount|` and
   `isReversible = mutationClass !== "destructive" && reversibility !== "none"`.
   **Production caveat:** no cartridge populates `reversibility` today (the gate
   falls back to `DEFAULT_RISK_INPUT.reversibility = "full"`), so this brake
   effectively reduces to `mutationClass !== "destructive"`. Any future executor
   for irreversible financial actions (payment charges/refunds) MUST register them
   as `mutationClass:"destructive"` (or supply `reversibility:"none"`) or they
   become eligible for auto-execute under threshold.
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
(non-nullable), so every deployment carries `threshold = 50`. This value is used
**only after** the explicit `spendAutonomyEnabled` opt-in (§3.2, rule 1b) — so the
$50 default is never an _unchosen_ auto-execute boundary. When an operator opts a
deployment in, $50 becomes its default reversible-standard-spend grant until they
tune `spendApprovalThreshold` per deployment.

`evaluate`'s `system_auto_approved` short-circuit (top of the method) is
untouched — it is an explicit "skip approval lookup" path for operator-direct
intents and is not part of the agent-autonomy lane.

### 3.4 Producer reality + honest boundary

The extractor (§3.1) reads a producer's **structured** spend field
(`spendAmount`/`amount`/`budgetChange`/`newBudget`). The end-to-end gate test
drives the gate from exactly that shape (`budgetChange`), not a hand-built
decision — per `feedback_safety_gate_needs_producer_population`.

**What we deliberately do NOT do:** we do not scrape Riley's `dollarsAtRisk` into
`parameters.spendAmount`. `dollarsAtRisk` comes from `estimateRisk`, which pulls
the first dollar value out of the human `estimatedImpact` string — an _impact
projection_ (often revenue/savings, e.g. "saves $450/mo"), **not** the budget
delta the threshold must compare against. Feeding it to the gate would
mis-classify under/over threshold. A correct Riley producer needs a **structured
budget-delta field** on `RecommendationOutput` (which it does not yet carry) AND a
path that routes it through `PlatformIngress` — neither exists today
(`operator.act_on_recommendation` submits only `{recommendationId, action, note}`).
The sink carries a code comment recording this prerequisite.

**Boundary flagged for review (not a hidden hole):** no _live_ path submits an
amount-carrying spend action through the gate today — Riley's apply is
human-initiated and only transitions recommendation state; the `digital-ads`
executor is an unregistered stub; `operator.record_revenue` is
`system_auto_approved` and _records_ revenue. So in production the lever is
**doubly dormant**: it needs (a) explicit `spendAutonomy` opt-in, (b)
`trustLevelOverride:"autonomous"`, AND (c) a producer that routes a structured
spend amount through the gate. Each absent ⇒ today's full approval-gating, so it
**fails safe**. Wiring an autonomous-agent spend-execution path is a larger,
separate workstream deliberately **out of scope**; gating a human-initiated click
by an _autonomy_ threshold would itself be a new illusion and is avoided.

Net effect of this PR: the stored field becomes **enforceable, correctly wired,
safe-by-default (explicit opt-in), and proven by tests** — no longer silently
ignored — without fabricating autonomy or feeding the gate a wrong number.

## 4. Safety invariants (must be test-pinned)

1. **Deny is untouchable.** For every combination of (autonomous, under/over
   threshold, reversible/irreversible, financial/not), a base `deny` stays
   `deny`. Spend-limit-exceeded deny + forbidden-behaviour deny both verified.
2. **Irreversible stays parked.** Autonomous + under-threshold + irreversible
   (`mutationClass:"destructive"` or `reversibility:"none"`) financial
   `require_approval` is **not** downgraded.
3. **Default is dormant.** Guided/supervised (or absent override) → no-op even
   with a threshold and a spend amount present. Byte-identical to today.
   3b. **Opt-in required.** An **autonomous** deployment that has NOT set
   `spendAutonomy=true` is a no-op even with the $50 column default present — the
   always-populated default never silently grants.
   3c. **Only standard approvals relax.** `elevated`/`mandatory` approvals (high
   risk, system-critical posture, manual gate) are never downgraded.
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

| File                                                                              | Change                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/schemas/src/policy-overrides-config.ts`                                 | add `resolveSpendAutonomyEnabled`                      |
| `packages/schemas/src/__tests__/policy-overrides-config.test.ts`                  | resolver tests                                         |
| `packages/core/src/engine/spend-limits.ts`                                        | extend `extractSpendAmount`                            |
| `packages/core/src/engine/__tests__/spend-limits.test.ts`                         | **new** unit tests                                     |
| `packages/core/src/platform/governance/spend-approval-threshold.ts`               | **new** pure helper (opt-in + standard-only)           |
| `packages/core/src/platform/__tests__/spend-approval-threshold.test.ts`           | **new** unit tests                                     |
| `packages/core/src/platform/governance/governance-gate.ts`                        | call helper after `toGovernanceDecision`               |
| `packages/core/src/platform/__tests__/governance-gate.test.ts`                    | extend: e2e + invariants                               |
| `packages/core/src/platform/deployment-context.ts`                                | add `spendAutonomyEnabled` field                       |
| `packages/core/src/platform/deployment-resolver.ts`                               | thread `spendAutonomyEnabled` (result + mapper)        |
| `packages/core/src/platform/prisma-deployment-resolver.ts`                        | resolve `spendAutonomyEnabled` from governanceSettings |
| `apps/api/src/bootstrap/platform-deployment-resolver.ts`                          | thread `policyOverrides` + `spendAutonomyEnabled`      |
| `apps/api/src/__tests__/platform-deployment-resolver.test.ts`                     | assert both forward                                    |
| `packages/ad-optimizer/src/recommendation-sink.ts`                                | document why spendAmount is NOT scraped                |
| `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`                 | assert no scraped spendAmount                          |
| `packages/core/src/skill-runtime/__tests__/deny-floor-trust-independence.test.ts` | pin lever outside the deny floor                       |

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
