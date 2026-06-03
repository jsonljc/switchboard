# Governed Handoff Contract Freeze

**Status:** Interface-freeze reference. Schema-anchored.
**Provenance:** Derived from the 2026-06-03 agent-synergy architecture audit
(`docs/audits/2026-06-03-agent-synergy-architecture/findings.md`) and the brainstorming
decisions of 2026-06-03.
**Scope:** Four cross-agent seams between Alex (medspa booking and conversion), Riley (ad
optimization), and Mira (creative director): three governed handoffs and one shared-data
contract.

## 0. Purpose

Freeze the governed seams between Alex, Riley, and Mira so parallel implementation on each
agent can proceed without coupling to another agent's internals. The contract is the unit of
agreement: a future PR verifies "did we honor the seam?" by checking the typed intent plus
payload at the `PlatformIngress` boundary, without arguing from prose. This document makes four
seams boring, auditable, repeatable, and hard to reinterpret. It is a reference, not an
implementation; the canonical payload types live in `@switchboard/schemas` so drift is caught by
typecheck rather than by review.

## 1. Shared Governance Rules

The four governance facts (bind the three governed handoffs, seams 1 to 3):

1. It enters through `PlatformIngress.submit()`, the one control plane. No mutating bypass path.
2. It re-runs `GovernanceGate.evaluate()` on the child WorkUnit, exactly once.
3. A system or cron initiated submit uses the seeded `{ id: "system", type: "system" }`
   principal. A bespoke `system:<x>` id has no `IdentitySpec`, so `loadIdentitySpec` throws and
   the gate hard-denies with empty `outputs:{}` (a silent no-op).
4. It carries a deterministic idempotency key.

Cross-cutting rules (apply to all four seams unless noted):

- **Build against the contract, not internals.** A workstream targets the typed intent and
  payload at the ingress boundary. Agent internals (Alex's persona and model routing, Mira's
  pipeline, Riley's engine) evolve freely beneath the seam.
- **Fail closed by default.** Unknown or missing input, a disabled target, or a cross-org
  deployment yields a typed failure code, never a phantom success.
- **Idempotency is mandatory** for the three governed handoffs. Seam 4 is a read, so its
  idempotency is event-level dedup and ordering owned by the bus and outbox, not an ingress key.
- **All shared payload types live in `@switchboard/schemas`.** Every consumer imports the type.
  A drift between Alex, Riley, Mira, or Ads breaks typecheck.
- **`system_auto_approved` is forbidden on any spend or budget path.** It short-circuits the gate
  before the spend post-processor (#788). Spend-bearing handoffs use a seeded
  `require_approval(mandatory)` Policy.

## 2. Schema Home Table

| # | Seam | Intent / contract | Canonical payload type | Schema home | Realized |
|---|---|---|---|---|---|
| 1 | Alex to Mira draft | `creative.concept.draft` | `CreativeConceptDraftInput` (`productDescription`, `targetAudience`, `valueContext?`) | `packages/schemas/src/creative-concept-draft.ts` | committed |
| 2 | Mira to Ads publish | `creative.job.publish` | `CreativeJobPublishInput` (`{ jobId }`) | `packages/schemas/src/creative-job.ts` | committed |
| 3 | Riley to agent advisory | `adoptimizer.recommendation.handoff` | `RecommendationHandoffInput` (`recommendationId`, `actionType`, `campaignId`, `rationale`, `evidence`) | `packages/schemas/src/recommendation-handoff.ts` | committed |
| 4 | Alex to Riley shared data | event, no intent | `ConversionEvent` / `ConversionRecord` | `packages/schemas/src/conversion.ts` | pre-existing |

Note: `packages/schemas/src/handoff.ts` is a different concept (the human-escalation handoff:
agent to human). The agent-to-agent seams above must never reuse it. "Realized" status is
point-in-time; see the appendix for verification state.

## 3. Contract Template

Every seam is defined by the same seven rows:

- **Identity:** the intent name (or "event, no intent" for a read), the initiator, and the
  schema home.
- **Payload:** the typed input fields (no `min`/`max` constraints; Anthropic strict tools reject
  them, so validate in Zod).
- **Approval owner:** who decides approval (auto, mandatory-human, or "not an approval handoff").
- **Fail-closed codes:** the exact outcome codes a consumer can branch on.
- **Idempotency key:** the deterministic key shape (or the event-dedup rule for a read).
- **Invariant honor:** how the seam satisfies the shared governance rules.
- **Evolution class:** how the seam may change (see section 5).

## 4. Contracts

### 4.1 Alex to Mira: creative concept draft

Purpose: Alex hands a qualified lead's creative concept to Mira as an internal draft (no spend,
no customer-facing send).

- **Identity:** intent `creative.concept.draft`; initiator Alex (the `delegate` tool); home
  `creative-concept-draft.ts`.
- **Payload:** `productDescription`, `targetAudience`, `valueContext?` (the lead's interest
  signal or estimated value, so Mira can prioritize). Downstream expands to `CreativeBriefInput`
  in `creative-job.ts`.
- **Approval owner:** auto (`approvalMode:"system_auto_approved"`). Justified: no spend, no
  outbound, a reversible draft row. This is the only seam where auto-approval is allowed,
  precisely because it carries no spend.
- **Fail-closed codes:** Mira disabled gives a graceful skip; missing or cross-org deployment
  gives `DEPLOYMENT_NOT_FOUND`; an invalid brief gives `INVALID_BRIEF`.
- **Idempotency key:** `delegate:${parentWorkUnitId}:creative.concept.draft:${hash(brief)}`
  (already deterministic in the delegate tool).
- **Invariant honor:** through ingress; child re-runs governance; draft-only is structural (the
  workflow never imports the creative pipeline and sends no Inngest event).
- **Evolution class:** additive only at the freeze (a new optional field such as `valueContext`
  is safe). Removing a field or changing draft-only semantics is breaking (new intent).

### 4.2 Mira to Ads: publish

Purpose: on mandatory human approval, Mira publishes a complete, kept creative as a PAUSED Meta
draft package for an operator to finalize in Ads Manager.

- **Identity:** intent `creative.job.publish`; initiator the operator route (a system submit);
  home `creative-job.ts` (`CreativeJobPublishInput`).
- **Payload:** `{ jobId }`. The handler resolves everything else from the persisted job and
  connection.
- **Approval owner:** mandatory human (a seeded `require_approval(mandatory)` Policy matching
  only `creative.job.publish`). Always parks. `approvalPolicy` on the intent registration is
  decorative; the seeded Policy row is what enforces it.
- **Fail-closed codes:** `CREATIVE_JOB_NOT_FOUND`, `CREATIVE_NOT_PUBLISHABLE`,
  `CREATIVE_ASSET_NOT_DURABLE`, `META_CONNECTION_NOT_FOUND`, `META_PAGE_NOT_CONFIGURED`;
  mid-chain Meta failure gives `CREATIVE_PUBLISH_META_ERROR`.
- **Idempotency key:** handler-internal (each `metaXId` is a checkpoint, reused on retry). Open
  gap (documented, out of this freeze's scope): the route passes no ingress key and is
  route-classed `lifecycle` while hosting mutating submits; hardening is a separate PR.
- **Invariant honor:** through ingress; mandatory approval; activation is structurally
  unreachable (`createAd` is PAUSED-only; `updateCampaignStatus("ACTIVE")` throws and is never
  called).
- **Evolution class:** the payload is intentionally minimal (`{ jobId }`); additive job fields
  are safe. This seam is inert until its producers land (durable asset URL and Meta page id),
  which are out of scope here and in flight elsewhere.

### 4.3 Riley to agent: advisory to action handoff

Purpose: Riley's weekly cron turns a typed recommendation into a governed, human-approved action
for the agent that can act on it (a Mira brief, or an Alex read-note), without giving Riley
budget authority.

- **Identity:** intent `adoptimizer.recommendation.handoff`; initiator the Riley cron (a system
  submit, not an LLM decision); home `recommendation-handoff.ts`.
- **Payload:** `recommendationId`, `actionType` (`refresh_creative` | `add_creative` |
  `lead_quality`), `campaignId`, `rationale`, `evidence`. A creative action maps to a
  `creative.concept.draft`-shaped brief (reuses Contract 1's target). A `lead_quality` action
  becomes an Alex read-note (a read surface, not an ingress mutation).
- **Approval owner:** a Mira-bound brief that will spend uses `require_approval` (never
  `system_auto_approved` on a spend path). A no-spend draft may auto. The Alex-note variant is
  read-only (no governance).
- **Fail-closed codes:** below Riley's evidence floor or a learning-reset class gives abstention
  (do not hand off). A disabled target agent gives a graceful skip.
- **Idempotency key:** `handoff:riley:${recommendationId}:${actionType}` (one handoff per
  recommendation).
- **Invariant honor:** through ingress; child re-runs governance; the cron uses the seeded
  system principal; advisory-only Riley stays advisory until a human approves the resulting
  action.
- **Evolution class:** adding an `actionType` member is safe only if every consumer handles it
  via exhaustive fallback; otherwise it is breaking. Granting Riley direct budget mutation is
  explicitly out of this contract (a later Phase-C concern).

### 4.4 Alex to Riley: shared data (blackboard)

Purpose: Alex's bookings emit a conversion event that Riley reads for trueROAS; this is a read
coupling over a shared schema, not a handoff.

- **Identity:** event, no intent. Producer Alex (`calendar-book` stamps a `booked` event onto
  `ConversionBus`). Consumer Riley (reads `ConversionRecord` via the
  `BookedValueByCampaignProvider` port). Home `conversion.ts`.
- **Payload:** `ConversionEvent` (`type`, `value`, `currency`, `sourceCampaignId`, `sourceAdId`,
  `attribution`, `occurredAt`, provenance fields).
- **Approval owner:** Not an approval handoff. Governance applies through provenance
  (`workTraceId` / `causationId`), freshness, org-scoping, and downstream read rules. The four
  governance facts do not bind this seam; it is a read and event coupling, never an ingress
  mutation.
- **Fail-closed codes:** not applicable (a read). A missing `value` reads as null at the
  trueROAS boundary, not an error.
- **Idempotency key:** not an ingress key. At-least-once delivery means consumers dedup by
  `eventId`; ordering and dedup are owned by the bus and outbox.
- **Invariant honor:** org-scoping on every read; the cents invariant is normative: `value` is
  in MINOR currency units (cents), converted to MAJOR units only at the Meta CAPI boundary
  (`normalizeConversionValue`). Provenance via `workTraceId` / `causationId`.
- **Evolution class:** changing the units or currency semantics (for example cents to major) is
  breaking and requires a coordinated migration of every consumer. Adding an optional
  attribution field is safe.

## 5. Contract Evolution Policy

- **Safe (no version bump):** add an optional field; add an enum member that every consumer
  already handles via an exhaustive or default fallback; relax an output tolerance.
- **Breaking (requires a new intent name `*.v2`, or an explicit version bump plus migration):**
  remove or rename a field; make an optional field required; narrow a type; change units or
  semantics (for example cents to major); change the approval owner or a fail-closed code that
  consumers branch on.
- **Deprecation path:** mark the old field or intent `@deprecated` in the schema; keep accepting
  it for at least one release while consumers migrate; remove only after every consumer is
  updated (typecheck-verified).
- **Versioning expectation:** the intent name is the version boundary. A breaking change to a
  frozen seam ships as a new intent, never as a silent mutation of the existing one.

## 6. Non-goals

- No full implementation in this document (the seams are realized in code on a separate branch;
  this is the reference).
- No full Zod definitions here (the payload rows are non-normative sketches; the normative types
  live in `@switchboard/schemas`).
- No UI copy specification.
- No backend orchestration rewrite.
- Not the human-escalation `handoff.ts` domain.
- Not granting Riley budget-mutation authority (a separate, later Phase-C concern, gated by the
  #788 spend caps).

## Appendix: realization status (point-in-time, 2026-06-03)

The contract types and the net-new Contract 3 were implemented on branch
`feat/agent-synergy-recommendation-handoff` (an autonomous-agent worktree), which was
interrupted by a session limit and is not yet verified green or reviewed. This spec is
independent of that branch's verification status: it freezes the contracts; the branch is one
realization that must pass the full green gate (`build`, `typecheck`, `test`, `lint`,
`format:check`) and an adversarial review before it is trusted or merged. Seam 2's producers
(durable asset URL, Meta page id) are in flight separately (`feat/creative-durable-asset-storage`)
and are out of scope here.
