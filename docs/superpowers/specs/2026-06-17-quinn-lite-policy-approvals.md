# Quinn-lite v1: policy, approvals, escalation (scope and determination)

Status: scope spec (captured 2026-06-17). This is the design-spec slice for Quinn-lite v1. It
resolves the four Quinn-lite product forks against ground truth and records a determination that
reshapes the build: **Quinn-lite's policy/approval/escalation machinery is already built on
`main` as the GovernanceGate + WorkTrace + approval-lifecycle spine.** This spec is the canonical
scope so future sessions do not re-derive it or rebuild GovernanceGate.

Parent direction: `docs/superpowers/specs/2026-06-14-revenue-proof-medspa-direction.md` (PR #1052).
Related memory: `project_revenue_proof_direction`. Sibling determination: Casey v1
(`docs/superpowers/specs/2026-06-16-casey-consent-identity.md`, PR #1122).

## One-line

Quinn-lite is the governed capability that owns the **policy/approval/escalation leg** of the
receipted-bookings proof chain (the thesis `policy_check_id` + `human_approval_id`): it decides
auto-approve vs manager sign-off vs block, and records every decision even when automatic.
Following the Ledger-lite and Casey precedent, "Quinn-lite" is a capability (a governed gate +
decision record + proof-chain references), **not** an LLM agent shell.

## Determination (the headline)

Ground truth on `main` (verified 2026-06-17, file:line below) shows the policy/approval/escalation
leg of Quinn-lite v1 is **already built**: `GovernanceGate.evaluate` is the auto-approve /
require-approval / deny decision engine, `WorkTrace` records every decision (including
auto-approve) as canonical persistence, the approval lifecycle parks/notifies/approves/dispatches,
and the receipted-booking view already carries `policy_check_id` (as `matchedPolicies`) and a
`human_approval_id` field. The roadmap's "Quinn-lite does not exist in code" is true only for an
*agent shell*; the *capability* exists, is governed, WorkTraced, and org-scoped, and is unconditional
(it runs on every `PlatformIngress.submit()`, the literal "thin but mandatory from day one").

What remains in Quinn-lite's charter is **not** the decision engine (built) or decision recording
(built). It is:

1. **One real, bounded proof-chain defect** (a real wiring gap, presently cosmetic):
   `human_approval_id` is structurally always-null
   because `WorkTrace.approvalId` is never stamped. It is **moot for receipts today** (no
   receipt-bearing booking flows through a real human-approval lifecycle), so fixing it now ships
   plumbing that still yields null. Documented below as the precise gated next-step, not shipped.
2. **Deferred-by-roadmap items**, each its own later kickoff: the mass-outbound approval gate
   (Robin-era), the org-wide decisions audit *surface* (3-6mo "stronger Quinn-lite workflows"),
   and the anti-fraud hardening of the approval leg (four-eyes, `approverPrincipalId`, persisted
   skill-mode booking-approval) per the receipted-bookings architecture map.

Therefore Quinn-lite v1 builds **no new decision engine and no new gate in this spec slice**. The
go-live state is already on; there is no flag to flip (see "Go-live state").

## Ground-truth map: what already satisfies Quinn-lite's policy/approval leg

| Quinn-lite responsibility | Status | Evidence (file:line on `main`) |
| --- | --- | --- |
| Decision engine (auto-approve / sign-off / block) | BUILT | `GovernanceGate.evaluate` `packages/core/src/platform/governance/governance-gate.ts:143-271`; outcomes `execute` / `require_approval` / `deny` via `decision-adapter.ts` |
| Auto-approve path + financial defense | BUILT | `system_auto_approved` short-circuit `governance-gate.ts:165-193`; F4 `assertNotSpendBearingAutoApprove` `packages/core/src/platform/intent-registration.ts:106-109`; D9-2 `isFinancialIntent` + `FINANCIAL_AUTO_APPROVE_DENYLIST` `governance-gate.ts:103-107,128-134` |
| Records EVERY decision incl. auto-approve | BUILT | `WorkTrace.governanceOutcome` + `riskScore` + `matchedPolicies` `packages/core/src/platform/work-trace.ts:21-23`; persisted for all three outcomes via `PlatformIngress.submit()` (`platform-ingress.ts` deny ~290 / require_approval 314 / execute 488-498); serialized `packages/db/src/stores/prisma-work-trace-store.ts:251-260` |
| Output-governance verdicts (banned-phrase / claim / consent / window) | BUILT | `GovernanceVerdictStore` `packages/core/src/governance/governance-verdict-store/types.ts`; `packages/db/src/prisma-governance-verdict-store.ts` (`listByConversation` / `listByDeployment` / `countByDeploymentAndClaim`) |
| Approval lifecycle (park -> notify -> approve -> dispatch-or-recovery) | BUILT | `createGatedLifecycle` `platform-ingress.ts:334-348`; `respondToParkedLifecycle` + `lifecycle-dispatch.ts` (`writeApprovedPayloadToTrace` -> `executeApproved`, dispatch failure -> `recovery_required`) |
| Approver identity + outcome persisted | BUILT | `WorkTrace.approvalRespondedBy` / `approvalOutcome` / `approvalRespondedAt` `work-trace.ts:28`; written on approve `lifecycle-dispatch.ts:61-68`, `lifecycle-service.ts:232`, `platform-lifecycle.ts:140` |
| `policy_check_id` in the proof chain | BUILT (partial/embedded, as specced) | `ReceiptedBookingView.matchedPolicies` `packages/schemas/src/receipted-booking.ts:100`; canonical `CheckCode` set `packages/schemas/src/decision-trace.ts:5-22`; computed `decision-adapter.ts:8`; read in `getView` `packages/db/src/stores/prisma-receipted-booking-store.ts:183` |
| `human_approval_id` field on the proof chain | BUILT (field) / DEFECTIVE (producer) | field `ReceiptedBookingView.humanApprovalId` `receipted-booking.ts:101`, read `prisma-receipted-booking-store.ts:184` from `WorkTrace.approvalId`; but `approvalId` is never stamped (see "The one defect") -> always null |
| Mass-outbound approval gate | NOT BUILT (Robin-era) | proactive sends route `PlatformIngress`+`GovernanceGate` with `approvalPolicy:"none"` (`apps/api/src/bootstrap/contained-workflows.ts` reminder 524 / followup 517 / greeting 504); per-contact eligibility only `proactive-eligibility.ts:39-88`; no mass/campaign send exists yet |
| Org-wide decisions audit *surface* | NOT BUILT (later window) | only a pending-approvals worklist `apps/api/src/routes/decisions.ts`; no decisions-by-outcome read for an org |
| Anti-fraud hardening (four-eyes, persisted skill-mode approval) | NOT BUILT (deferred) | arch map `docs/audits/2026-06-05-receipted-bookings-architecture/receipted-bookings-architecture-map.md:131,209,226` (#7); skill-mode can't park `packages/core/src/skill-runtime/skill-executor.ts:550-555` |

## The one defect: `human_approval_id` is structurally always-null (and moot today)

`ReceiptedBookingView.humanApprovalId` reads `WorkTrace.approvalId` (`prisma-receipted-booking-store.ts:184`).
`WorkTrace.approvalId` is **never written**:

- At park time, `PlatformIngress` persists the trace at `platform-ingress.ts:314` **before** the
  lifecycle is created at `:334`, so it cannot carry the lifecycle id. The `approvalId: lifecycle.id`
  at `:352` is on the **notification payload**, not the trace.
- At approve time, `writeApprovedPayloadToTrace` (`lifecycle-dispatch.ts:61-68`) stamps
  `approvalOutcome` / `approvalRespondedBy` / `approvalRespondedAt`, but **not** `approvalId`.

So the approver identity and outcome *are* persisted on the booking's trace, but the id the proof
chain reads is always null. The minimal fix is to stamp `approvalId: lifecycle.id` in the approve-time
trace update (the `lifecycle` record is in scope; `WorkTraceUpdate` already accepts `approvalId`,
`prisma-work-trace-store.ts:545`).

**Why it is not shipped in v1**: it is moot for receipts. No booking that becomes a receipt flows
through a real human-approval lifecycle today: skill-mode (Alex's booking path) returns a synthetic
`pendingApproval()` ToolResult with no `ApprovalLifecycle` and no resume (`skill-executor.ts:550-555`,
the `feedback_skill_runtime_two_constraint_regimes` gap); the booking/lead/reminder intents are
`approvalPolicy:"none"`; the `require_approval` intents that do create real lifecycles are Riley
spend levers and Mira creative jobs, none receipt-bearing. Stamping `approvalId` therefore yields a still-null
`humanApprovalId` until either skill-mode approval-parking is built or a governed approval-bearing
booking intent exists; both are their own slices. Shipping the stamp now would be plumbing with no
live consumer. It is recorded here as the exact gated next-step so it is a one-line change the day an
approval-bearing booking path lands.

## The four product forks, resolved

### (a) `policy_check_id` / `human_approval_id`: one built (embedded), one wired-but-moot

- **`policy_check_id` is BUILT, as the spec's "partial (embedded)" shape.** The proof chain carries
  `matchedPolicies`, the canonical `CheckCode` set (`POLICY_RULE`, `SPEND_LIMIT`,
  `MANUAL_APPROVAL_GATE`, `RISK_SCORING`, ...) that fired for the booking's governance decision,
  plus the `SPEND_APPROVAL_THRESHOLD` marker when autonomy acts. It is a real, stable, canonical
  identifier of "which guardrail or approval rule fired", not a freeform blob and not a fake id.
  For a `system_auto_approved` booking it is empty (`[]`), which is the honest answer: no policy
  rule fired, the action was system-auto-approved and that fact is itself recorded
  (`governanceOutcome`). No change needed for v1. A first-class single `policyCheckId` (a synthetic
  hash/id over the matched set) would be cosmetic over the embedded evidence; defer unless a
  consumer needs a join key.
- **`human_approval_id` is wired but always-null and moot** (see "The one defect"). Resolution:
  document the stamp as the gated next-step; do not ship moot plumbing.

### (b) Decision recording: recording is BUILT; the audit *surface* is a later window

Every governance decision, including auto-approve, is already recorded to `WorkTrace` as canonical
persistence (`governanceOutcome` + `riskScore` + `matchedPolicies` + the approval fields on
sign-off). The spec's "records every decision even when automatic" is satisfied at the *recording*
layer today. What does not exist is an **owner/operator-facing decisions surface**: an org-wide
read of decisions-by-outcome (how many auto-approved vs required sign-off vs blocked). The only
decision read today is the pending-approvals worklist (`decisions.ts`).

That surface is **out of v1**: the parent roadmap places "stronger Quinn-lite workflows" at 3-6
months and "Quinn full approval flows" at 6-12 months, while v1 Quinn-lite is "thin but mandatory,
mostly hidden, not marketed." A decisions audit log is a read-only report slice (a store query over
`WorkTrace` filtered by org + outcome, feeding a report tile) that can be built when an owner
actually needs the audit view. It does not gate the proof chain and is not the thesis. Defer.

### (c) Mass-outbound gating: Robin-era, and gating today's sends would be wrong

The spec line "mass outbound is approval-gated through Quinn-lite" is the prerequisite for **Robin**
(recovery/show-rate: confirmations, cancellation recovery, waitlist fill, no-show reconversion),
the agent that *creates* mass/proactive campaigns. That agent does not exist. Today's proactive
sends are per-booking transactional messages (appointment reminder, follow-up, first-touch greeting)
that already route through `PlatformIngress` + `GovernanceGate` and are gated per-contact by
`evaluateProactiveSendEligibility` (consent + 24h window + approved template). They are correctly
`approvalPolicy:"none"`: a consented, template-gated, per-contact transactional reminder must not
require manager sign-off. Adding a recipient-count approval threshold is meaningful only once a
true mass/campaign send path exists, which is Robin's build. **Defer to Robin's kickoff** (this loop
must not build Robin). When it lands, the gate is a new `approvalPolicy:"threshold"` registration on
the campaign intent plus a recipient-count policy, and the GovernanceGate machinery already supports it.

### (d) Enforcement vs measurement: v1 adds neither a new gate nor new enforcement

GovernanceGate **is** the enforcement layer, and it is built. Quinn-lite v1 does not add a new
gating decision (that would be rebuilding GovernanceGate) and does not add a new measurement gate
(the proof-chain `policy_check_id` is populated; `human_approval_id` is wired). The highest-leverage
bounded scope is therefore **neither**: it is the determination itself plus the precise gated
next-steps. This is the named loop stop reason: "ground truth shows the capability is largely
already built; do not invent work to fill the loop."

## Go-live state (already on; no lever to flip)

Unlike Casey (whose enforcement is a per-org `consentState.mode` flip), Quinn-lite's gate has **no
off switch and needs none**. `GovernanceGate.evaluate` runs on every `PlatformIngress.submit()` by
construction: every mutating action is already governed and every decision already recorded. That
*is* the "thin but mandatory from day one" charter. The per-org autonomy/trust posture
(`governanceSettings.trustLevelOverride`, spend thresholds) tunes *how* the gate decides, but the
gate is always in the path. There is nothing to provision for Quinn-lite v1.

## Independent review findings (2026-06-17)

A fresh-context adversarial review of the governance/approval/verdict machinery (hunting for a live,
non-moot defect that would warrant a focused fix PR in this loop, with the consent-reader IDOR lesson
as the primary lens) returned **no live defect**. The machinery is sound. Per-lens dispositions:

1. **Org-scope / IDOR**: sound. `WorkTrace.getByWorkUnitId` keys on a globally-unique work-unit id
   with org-access enforced at the route layer; `ApprovalLifecycleService.listOperatorActionableLifecycles`
   is org-scoped by its caller; the decisions/approvals/governance routes are org-scoped at auth.
   ONE latent (not-live) note: `GovernanceVerdictStore.listByConversation` / `listByDeployment`
   (`packages/db/src/prisma-governance-verdict-store.ts`) do not filter `organizationId`, but they
   are **not reachable from any HTTP route**, so there is no cross-tenant exposure today. Recorded as
   a defense-in-depth follow-up (add the `organizationId` filter when/if these readers are ever
   surfaced), per the standing rule that any `*Reader` / `*Store` read leg keyed on a bare id should
   carry an org filter. Not a v1 fix slice: not live-reachable, and it touches the verdict store
   (a governance stop-glob), so it lands with its first real consumer, not speculatively.
2. **Self-approval / four-eyes**: solid. `respondToParkedLifecycle` blocks `trace.actor.id ===
   respondedBy` unless `ALLOW_SELF_APPROVAL` is explicitly set; no bypass found.
3. **Financial auto-approve slip**: tight. Every `system_auto_approved` (`operator_mutation`) intent
   is write-class and carries no outbound spend (clinic revenue is inbound-only; `operator.record_revenue`
   is explicitly excluded from financial scrutiny at `governance-gate.ts:84-90`). No financial intent
   rides the auto-approve short-circuit.
4. **NaN-blind / fail-open**: none. `isFinancialIntent` / `extractSpendAmount` are finiteness-guarded,
   and `spend-approval-threshold.ts` no-ops on a non-finite spend amount.
5. **`approvalId`-null**: confirmed **cosmetic**, not an integrity bug. No code path depends on
   `WorkTrace.approvalId` being non-null; it is an always-empty display field, exactly as "The one
   defect" describes. Moot, not a bug warranting a separate PR.

The review reinforces the determination: Quinn-lite v1's approval machinery is already built and
working correctly. No fix slice is opened in this loop.

## Open decisions (for the deferred kickoffs)

These are product/compliance calls, not engineering defaults, owed when each deferred item is picked
up:

1. **Approval-bearing booking path** (unblocks `human_approval_id`): does the product want bookings
   to ever require human sign-off? If yes, that requires solving skill-mode approval-parking (the
   `feedback_skill_runtime_two_constraint_regimes` architecture gap) or routing approval-bearing
   bookings through a governed operator intent. Only then does stamping `approvalId` produce a
   non-null `human_approval_id`. This is an architecture decision, not a thin slice.
2. **First-class `policy_check_id`**: keep the embedded `matchedPolicies` evidence (recommended), or
   mint a synthetic stable `policyCheckId` join key over the matched set? Only worth it if a
   consumer needs to join decisions across receipts.
3. **Mass-outbound approval policy** (Robin-era): recipient-count threshold? per-campaign approval?
   who approves? Answered at Robin's kickoff, against a real campaign send path.
4. **Decisions audit surface** (later window): which outcomes, what window, owner-facing or
   operator-only? A read-only report slice when an owner needs the audit view.
5. **Anti-fraud hardening** (per the architecture map): `approverPrincipalId` on `ApprovalLifecycle`
   + fail-closed four-eyes + persisted skill-mode booking-approval + external anchoring. Deep
   security work that overlaps the skill-mode gap; its own audit-driven slice.

## Out of scope

- Robin (recovery/show-rate) and its mass-outbound campaigns; Mira (creative). Each is its own
  product kickoff per the MVP order Ledger-lite -> Casey -> Quinn-lite -> Robin.
- Rebuilding or wrapping GovernanceGate, the policy engine, or the approval lifecycle (all built).
- The decisions audit surface, the mass-outbound gate, and the anti-fraud hardening (deferred above).

## Non-negotiables (inherited, for any future Quinn-lite slice)

PlatformIngress is the only mutating entry; WorkTrace stays canonical; approval is lifecycle state,
not a route-owned side effect; the receipted-booking read-model is never a parallel control plane.
Layering schemas L1 -> core L3 (no db) -> db L4 -> apps L5. Every governance/approval/verdict read
leg org-scoped (the F12 / consent-reader IDOR lesson: any `*Reader` / `*Store` read keyed on a bare
id needs an `organizationId` filter). NaN-safe gate math. `system_auto_approved` must never be used
for a financial/spend-bearing intent (it short-circuits the spend gate; financial intents
`require_approval`). Any flag-gated control ships with its producer population in the same PR. Schema
change implies a migration in the same commit. No em-dashes.
