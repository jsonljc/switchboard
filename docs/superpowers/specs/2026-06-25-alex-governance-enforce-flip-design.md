# Alex governance enforce-flip: safe per-gate observe -> enforce enablement

**Date:** 2026-06-25
**Status:** Design
**Workstream:** Alex governance (follows P2-A observe-activation #1283)
**Branch (docs):** `docs/alex-governance-enforce-flip`

## 1. Problem

P2-A (#1283) seeded an all-gates-**observe** `governanceConfig` on every real-org Alex
deployment, so the five afterSkill governance gates now run as telemetry. The payoff of
that investment is the ability to move a gate from observe to **enforce** once the observe
bake has been reviewed and the gate's producer is populated. Today that payoff is
unreachable:

1. **No code path moves a gate observe -> enforce.** `governanceConfig` is written only by
   seeds/provisioning (`ensure-alex-listing.ts`, `seed-marketplace.ts`,
   `provision-org-agents.ts`), all of which write observe and are guarded on `null` so they
   never clobber. There is no operator-facing writer. (Verified: a repo-wide search for
   `governanceConfig` writes finds only those three seed sites.)
2. **No operator surface reviews the observe verdicts.** The gates write `GovernanceVerdict`
   rows; nothing surfaces them. An operator cannot see what a gate _would_ block before
   flipping it.
3. **Enforce-readiness signals exist but are not tied to a per-gate guard.** Enforcing a
   producer-dependent gate with an empty producer is dangerous: the price gate blocks every
   priced reply, the claim classifier escalates every efficacy claim. Nothing prevents an
   operator from flipping into that state.

This slice builds the safe enforce-flip enablement: review the observe bake per gate, see
per-gate enforce-readiness, and flip a gate observe -> enforce per org **only when that
gate's producer is populated**, audited and reversible. Observe stays the safe floor;
enforce is opt-in per gate per org. This is the compliance lever for a regulated SG medspa
go-live.

## 2. Current state (verified against `origin/main` 70cf85b82)

**Config shape** (`packages/schemas/src/governance-config.ts`). `GovernanceConfigSchema` is
a `.passthrough()` object with required `jurisdiction` (`"SG"|"MY"`) and `clinicType`
(`"medical"|"nonMedical"`) plus per-gate mode sub-blocks. The four afterSkill reply gates
map to four independent mode-bearing units:

| Flippable unit (config key) | Gate(s)                     | Mode resolver                  |
| --------------------------- | --------------------------- | ------------------------------ |
| `deterministicGate.mode`    | banned-phrase **and** price | `resolveGovernanceMode`        |
| `claimClassifier.mode`      | claim classifier            | `resolveClaimClassifierConfig` |
| `consentState.mode`         | PDPA consent                | `resolveConsentStateConfig`    |
| `whatsappWindow.mode`       | WhatsApp 24h window         | (inline in the hook)           |

Modes are `off | observe | enforce`. Because the parent schema is `.passthrough()`, writing
a per-gate mode is a JSON-column update with **no migration**. `recovery` (Robin's cron) and
`lifecycleTagging` (binary on/off) are not afterSkill reply gates and are out of scope.

**Gate behaviour, verified by reading each hook:**

| Unit              | Observe                                | Enforce                                                              | Producer (for safe enforce)                                                                                                | Over-blocks if producer empty?                                                                                                                                                        |
| ----------------- | -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deterministicGate | verdict only, response unchanged       | banned-phrase/price match -> handoff, status flip, response replaced | banned-phrase: static jurisdiction list (always ready). price: `getApprovedPrices(orgId)` from playbook `services[].price` | **YES** (price): empty -> every price claim is unsubstantiated -> blocks every priced reply (`price-claim-gate.ts:120-122`)                                                           |
| claimClassifier   | detached telemetry, response unchanged | escalate/rewrite -> response replaced                                | `ApprovedComplianceClaim` rows (+ regulatory fallback)                                                                     | **YES**: empty -> escalates every efficacy claim                                                                                                                                      |
| consentState      | verdict only, response unchanged       | **only** a revoked-contact race blocks; disclosure path never blocks | per-contact consent records (accrue at runtime)                                                                            | **NO**: fail-safe by construction (`pdpa-consent-gate.ts:134-178` blocks only on `decision.action==="block"` = revoked; allow path 180-252 records but never blocks, even in enforce) |
| whatsappWindow    | verdict only, no substitution          | out-of-window -> template substitution or blanked response + handoff | approved WhatsApp templates via `templateApprovalSource.resolve(deploymentId)`                                             | **YES**: empty templates -> out-of-window sends blanked                                                                                                                               |

**Posture-cache fail-closed arming (important second-order effect).** Each gate caches its
last-known posture (`postureCache.remember`). On a resolver _error_, a gate whose last-known
mode was `enforce` fails **closed** (blocks): deterministic, claim, and whatsapp gates block;
consent does not block on the allow path even when failing closed. Consequence: flipping a
gate to enforce also arms a "block on governance-system outage" branch for those three gates.
Enforce therefore has a real blast radius beyond steady-state detection; observe never arms
this branch. This is surfaced to the operator at flip time, not hidden.

**Read primitives that already exist.** `GovernanceVerdictStore` (core interface;
`packages/db/src/prisma-governance-verdict-store.ts`) has `listByDeployment(deploymentId,
{since, limit})` and `countByDeploymentAndClaim(...)`. The readiness route
(`apps/api/src/routes/readiness.ts`) already probes some producers (`checkServicesDefined`,
`businessFactsStatus`) and computes `governanceActivated`.

**Operator-mutation path.** `PlatformIngress.submit()` dispatches `operator_mutation` intents
through a governed path that records to WorkTrace. `memory.write`
(`apps/api/src/bootstrap/operator-intents/memory-write.ts`) is the canonical exemplar of a
non-financial, org-scoped, `system_auto_approved` deployment-config mutation to mirror.

## 3. Design decisions

### (a) Flip granularity: per-gate = the four config mode units

Expose exactly the four flippable units above. The banned-phrase + price coupling under
`deterministicGate.mode` is intentional (documented at `price-claim-gate.ts:83-89`); we
respect it and treat "deterministic" as one unit. If price ever needs to be staged
independently of banned-phrase, the documented path is a `priceGate.mode` passthrough
fallback; that is out of scope here. We do not expose `recovery`/`lifecycleTagging`.

### (b) Per-gate enforce-readiness: REFUSE-by-default, consent is the fail-safe exception

A gate may be flipped to `enforce` only when its producer is populated. Default is **REFUSE**
when the producer is absent (fail-safe: never let an enforce flip block legitimate replies
because the producer is empty). The policy per unit:

- **deterministicGate**: REFUSE unless `getApprovedPrices(orgId)` returns at least one price.
  (The banned-phrase half is always ready, but the price half is the dangerous half of the
  coupled unit, so the unit's readiness equals the price producer.)
- **claimClassifier**: REFUSE unless the org has at least one `ApprovedComplianceClaim`.
- **whatsappWindow**: REFUSE unless the org has at least one approved WhatsApp template.
- **consentState**: ALLOW enforce with no producer gate. Its enforce is fail-safe by
  construction: it blocks only a revoked-contact race and never blocks the allow path, so an
  empty producer cannot over-block. Gating it on a producer would be security theatre. We
  still surface what consent flagged in observe so the operator decides with eyes open.

Readiness is evaluated by a **pure** `evaluateGateEnforceReadiness(unit, signals)` over a
`GateProducerSignals` struct (approved-price count, approved-claim count, approved-template
count). A db-backed probe assembles the signals; the pure evaluator decides. Both the read
endpoint and the flip handler call the same evaluator, so the displayed readiness and the
enforced readiness can never drift.

### (c) Where the surfaces live

Backend (apps/api), three additions, all org-scoped:

1. **Observe-review read endpoint** (read-only): `GET /agents/:agentId/governance/observe-review?since=`
   -> per-gate would-act counts + sample verdict rows. (Slice 1)
2. **Enforce-readiness read endpoint** (read-only):
   `GET /agents/:agentId/governance/enforce-readiness` -> per-gate
   `{currentMode, ready, blockingReason, producerSummary}`. (Slice 2)
3. **Governed flip route** (mutating, ingress-compliant):
   `POST /agents/:agentId/governance/gates/:unit/mode` -> builds and submits the
   `governance.set_gate_mode` operator-mutation intent via `platformIngress.submit()`. The
   route is a thin translator; it does not own the DB write. (Slice 3)

Frontend (apps/dashboard): a new `/settings/governance` ("Compliance gates") page showing,
per gate, the observe review, the enforce-readiness status, and the flip control (disabled
with the REFUSE reason shown when not ready). Next proxy routes + React Query hooks reuse the
existing `governance` query namespace and api-client module. (Slice 4) The account-level
`governance-mode.tsx` (org trust posture: observe/guarded/locked) is a different axis and is
untouched; the new page is labelled to distinguish compliance-gate enforcement from it.

### (d) Audit/approval: governed operator_mutation, system_auto_approved, server-side readiness REFUSE

The flip is a `governance.set_gate_mode` `operator_mutation` intent through
`PlatformIngress.submit()` (mirrors `memory.write`): `approvalMode: "system_auto_approved"`,
`approvalPolicy: "none"`, `mutationClass: "write"`, idempotent, non-financial (so the F4/D9-2
financial-intent guards do not trip). Every flip (and every refused flip) is recorded in
WorkTrace.

The **authoritative safety gate is server-side, inside the handler**, not a second human:
when the target mode is `enforce` and the gate is not ready, the handler returns
`{outcome: "failed", error: {code: "GATE_NOT_ENFORCE_READY", ...}}` and writes nothing. This
cannot be bypassed by submitting the intent another way, and the refused attempt is audited.
Rollback (enforce -> observe or off) is **never** readiness-gated: disarming a gate must
always be fast and unconditional.

We choose `system_auto_approved` over `require_approval` deliberately: the flip is reversible,
fully audited, and operator-initiated from an authenticated surface, and the only dangerous
direction (over-blocking legitimate replies) is already prevented by the readiness guard,
which a second approver cannot substitute for. A `require_approval` posture would add a
parking/lifecycle dependency and a second-operator bottleneck for a safe, reversible action,
and would wrongly gate the disarm direction. An org that later wants 4-eyes can layer a
`require_approval` governance policy via the existing allow + require_approval cohort
mechanism with no rework here.

The route that calls `submit()` checks the **full** `SubmitWorkResponse`: success is
`response.ok === true && response.result.outcome === "completed"`. A `failed` outcome
(readiness REFUSE, or deployment-not-found) maps to a 4xx with the reason; we never read
`ok` alone as success.

### (e) Verdict-review surface scope

Per gate, over a window (default last 7 days, configurable via `since`):

- **Would-act counts** broken down as would-block / would-rewrite / would-escalate. In
  observe the stored `action` is `allow`, so the would-be enforce action is **derived** from
  `(sourceGuard, reasonCode)` by a pure `deriveEnforceAction(sourceGuard, reasonCode)`
  mapping (e.g. `banned_phrase_scanner|price_gate -> block`; `claim_classifier +
unsupported_claim_rewritten -> rewrite`, `+ unsupported_claim_escalated -> escalate`;
  `consent_gate + consent_revoked -> block`, disclosure reasons -> none; `whatsapp_window`
  block reasons -> block, `template_required` -> template). The mapping is the single source
  of truth for "what enforce would have done".
- **Sample verdict rows** (a small cap, e.g. 20): reasonCode, derived action, `decidedAt`,
  `conversationId`, and truncated/redacted text, for operator inspection.

Counts come from a new bounded `summarizeByDeployment(deploymentId, {since})` store
aggregation (GROUP BY `sourceGuard`, `reasonCode`, `action`) so counts are accurate without
an unbounded row fetch; samples come from `listByDeployment` with a small limit. All reads
are strictly org-scoped (the deployment is resolved by the requesting org); the agent reply
text shown is the operator's own org data.

## 4. Components and slices

Four PR-sized slices, dependency-ordered. Slices 1 and 2 are independent; 3 depends on 2; 4
depends on 1, 2, 3.

**Slice 1: observe-review read surface (backend).**

- `summarizeByDeployment(deploymentId, {since})` on `GovernanceVerdictStore` (core interface
  - prisma impl + any in-memory test impl).
- `deriveEnforceAction(sourceGuard, reasonCode)` pure mapping + the per-gate aggregation that
  rolls verdict summaries into per-unit would-act counts.
- `GET /agents/:agentId/governance/observe-review` route, org-scoped, returning per-unit
  counts + sample rows.

**Slice 2: enforce-readiness evaluator (backend, safety-critical core).**

- `GateProducerSignals` type + pure `evaluateGateEnforceReadiness(unit, signals)` returning
  `{ready, blockingReason}` per unit, with the REFUSE-by-default + consent-exception policy.
- A db-backed producer probe assembling `GateProducerSignals` for a deployment/org
  (approved-price count, approved-claim count, approved-template count).
- `GET /agents/:agentId/governance/enforce-readiness` route returning per-unit
  `{currentMode, ready, blockingReason, producerSummary}`.

**Slice 3: governed per-gate flip route (backend).**

- `governance.set_gate_mode` operator-mutation intent: intent string, parameter schema
  (`{unit, mode}`), handler factory (mirror `memory.write`), registration
  (`system_auto_approved`), bootstrap wiring.
- A store writer `setGovernanceGateMode({organizationId, deploymentId, unit, mode})` that
  read-modify-writes the one sub-block, **org-scoped in the WHERE**, and is **lost-update-safe
  under concurrent per-gate flips** (a locked read inside a transaction, so a concurrent flip
  to a different sub-block is never silently reverted).
- The **readiness REFUSE** inside the handler: target `enforce` + not-ready -> `failed`,
  reusing the Slice 2 evaluator + probe. Rollback never gated.
- `POST /agents/:agentId/governance/gates/:unit/mode` route that submits the intent and maps
  the full response (`completed` -> 200; `failed`/REFUSE -> 4xx with reason).
- Safety tests: an enforce flip is REFUSED when the producer is absent; observe -> enforce
  changes the gate's behaviour end-to-end **only** when ready (a behavioural test driving the
  gate with the post-flip config).

**Slice 4: dashboard governance surface (frontend).**

- `/settings/governance` page + nav entry; per-gate cards combining observe-review,
  enforce-readiness, and the flip control (disabled + REFUSE-reason when not ready; an enforce
  confirmation that states the fail-closed-on-outage consequence).
- Next proxy routes for the three backend endpoints; React Query hooks
  (`use-governance-gates`) mirroring `use-business-facts`; query-keys additions.

## 5. Data flow

```
Review:    dashboard /settings/governance
             -> GET /governance/observe-review  -> summarizeByDeployment + deriveEnforceAction -> per-unit would-act counts + samples
             -> GET /governance/enforce-readiness -> producer probe + evaluateGateEnforceReadiness -> per-unit {ready, blockingReason}

Flip:      dashboard flip control (enabled only when ready)
             -> POST /governance/gates/:unit/mode
                  -> platformIngress.submit({intent: "governance.set_gate_mode", params: {unit, mode}, ...})
                       -> operator_mutation handler:
                            if mode === "enforce" and not evaluateGateEnforceReadiness(unit, probe(org)).ready:
                                 return { outcome: "failed", error: GATE_NOT_ENFORCE_READY }   // audited, no write
                            else:
                                 setGovernanceGateMode(org, deployment, unit, mode)            // locked read-modify-write, org-scoped
                                 return { outcome: "completed" }
             -> route maps outcome -> 200 | 4xx(reason)
             -> next gate resolve caches the new posture; enforce arms fail-closed-on-outage
```

## 6. Safety

- **Observe stays the safe floor.** Nothing in this slice changes observe behaviour or the
  seeded posture. Enforce is opt-in per gate per org and reversible.
- **The readiness REFUSE is authoritative and server-side.** Proven by a test: an enforce
  flip with an empty producer returns `failed` and writes nothing; the same flip with the
  producer populated writes `enforce`. The dashboard readiness display is advisory only.
- **Rollback is unconditional.** enforce -> observe/off is never readiness-gated, so a
  misbehaving gate can always be disarmed immediately.
- **Concurrent flips are lost-update-safe.** The store writer locks the deployment row inside
  a transaction before the read-modify-write, so a concurrent flip to a different sub-block is
  never silently reverted.
- **The fail-closed-on-outage consequence is surfaced**, not hidden, at flip time.

## 7. Testing strategy

- Slice 1: `summarizeByDeployment` (db, mocked Prisma) groups + counts correctly;
  `deriveEnforceAction` mapping table (pure); route returns per-unit counts + samples and is
  org-scoped.
- Slice 2: `evaluateGateEnforceReadiness` table-driven over every unit x producer-present/
  absent, asserting REFUSE-by-default and the consent ALLOW exception; probe assembles signals;
  route shape + org scope.
- Slice 3: handler REFUSES enforce when not ready (the safety invariant) and allows rollback
  unconditionally; store writer org-scopes its WHERE and is lost-update-safe (concurrent-flip
  test); a behavioural test that the post-flip enforce config actually changes a gate's reply,
  and the post-flip observe config does not; the route maps `completed`/`failed` correctly and
  checks the full `SubmitWorkResponse`.
- Slice 4: hooks gate loading on `!data && !error`; the flip control is disabled when not
  ready; the enforce confirmation states the consequence; proxy routes forward org scope.

Verification per slice: `pnpm --filter <pkg> exec tsc --noEmit` for each touched package +
targeted tests + `pnpm test`. No schema change, so no `db:check-drift`. Gate the merge on real
`gh pr checks` conclusions (the non-required "Eval - Claim Classifier" check is persistently
red on main for billing reasons and is not chased).

## 8. Scope

**In scope:** the four slices above. Per-gate observe -> enforce flip for Alex, readiness-
guarded, audited, reversible, with an operator review + flip surface.

**Explicitly out of scope (named, not started):**

- Splitting price from banned-phrase (`priceGate.mode` passthrough). Only if independent
  staging is needed.
- A `require_approval` (4-eyes) posture for the flip. The architecture supports layering it
  later via the existing policy cohort.
- Riley/Mira gate flips (F3). This slice is Alex-scoped; the same surfaces generalise later.
- Capturing real jurisdiction/clinicType at onboarding (separate follow-up).
- Populating the producers themselves (approved prices/claims/templates are operator data;
  their editors exist or are separate work). This slice gates _on_ them, it does not fill them.

## 9. Risks and limitations

- The producer probes must read the _same_ sources the gates read (price: playbook
  `services[].price`; claims: `ApprovedComplianceClaim`; templates: the template approval
  source), or readiness could green-light an enforce that still over-blocks. Each probe is
  unit-tested against the gate's actual producer accessor.
- The `deriveEnforceAction` mapping must stay in sync with the gates' enforce behaviour. It is
  centralised in one pure function with a table-driven test, and the verdict `reasonCode`
  enum is the contract.
- Verdict volume over a long window could be large; counts use a bounded SQL aggregation (not
  a row fetch), and samples are capped.
