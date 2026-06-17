# Casey v1: consent, intake, identity (scope and determination)

Status: scope spec (captured 2026-06-16). This is the design-spec slice for Casey v1. It
resolves the four Casey product forks against ground truth, and records a determination that
reshapes the build: **Casey's consent leg is already built on `main`.** This spec is the
canonical scope so future sessions do not re-derive it.

Parent direction: `docs/superpowers/specs/2026-06-14-revenue-proof-medspa-direction.md` (PR #1052).
Related memory: `project_revenue_proof_direction`.

## One-line

Casey is the governed capability that owns the **consent leg** of the receipted-bookings proof
chain (the thesis `consent_id`): channel-tagged, seller-scoped, timestamped consent with
revocation state, plus intake completeness and identity. Following the Ledger-lite v1 precedent,
"Casey" is a capability (governed object + operator intents + reads + enforcement), not an LLM
agent shell.

## Determination (the headline)

Ground truth on `main` (verified 2026-06-16, file:line below) shows the consent leg of Casey v1
is **already built** across the consent machinery, the F15 booking precondition (#1039), and the
receipt track (#1044, #1062-#1110). The roadmap claim that "Casey does not exist in code" is true
only for an *agent shell*; the *capability* exists and is governed, WorkTraced, and org-scoped.

What remains in Casey's charter is **not** the consent object (built). It is two deferred
kickoffs, each needing its own product/compliance decision:

1. **Automated identity matcher** (a better `duplicate_contact_risk` producer than the manual
   `flag_duplicate`). Deferred: collision-prone contact/identity seam, lowest-leverage exception
   code, and a genuine PHI-context product/compliance decision (see "Open decisions").
2. **Broader intake-completeness signal** (beyond consent-completeness). Optional and
   low-leverage: the compliance-critical intake signal already ships; a composite name/phone/
   service score is an operator nicety, not a proof-chain requirement.

Therefore Casey v1 builds **no new code in this spec slice**. The go-live action for Casey's
consent enforcement is operational (a per-org flag flip), not a build (see "Go-live lever").

## Ground-truth map: what already satisfies Casey's consent leg

| Casey responsibility | Status | Evidence (file:line on `main`) |
| --- | --- | --- |
| Consent object (timestamped, revocable) | BUILT | `packages/db/prisma/schema.prisma:1812-1819` (`pdpaJurisdiction`, `consentGrantedAt`, `consentRevokedAt`, `consentSource`, `aiDisclosureVersionShown/At`, `consentUpdatedBy`, `consentNotes`); schemas `packages/schemas/src/pdpa-consent.ts` |
| Channel-tagging | BUILT (v1 shape) | `consentSource` enum tags the channel of the consent action: `whatsapp_quick_reply` / `ig_dm_reply` / `web_form` / `operator_recorded` / `inbound_keyword_revocation` / `operator_recorded_revocation` (`pdpa-consent.ts`) |
| Revocation state | BUILT | `consentRevokedAt` + `deriveConsentStatus` (revoked wins) + `evaluateConsentGate` (`pdpa-consent.ts`); inbound revocation `packages/core/src/channel-gateway/consent-revocation-gate.ts` |
| Governed consent mutations | BUILT | `operator.grant_consent` / `revoke_consent` / `clear_consent` (`apps/api/src/bootstrap/operator-intents/consent.ts`), recipe `operator_mutation` + `system_auto_approved` (`operator-intents.ts:223-282`), via `PlatformIngress.submit()` only (`apps/api/src/routes/admin-consent.ts`), WorkTraced, org-scoped (`packages/db/src/prisma-consent-store.ts`) |
| Consent completeness (intake measurement) | BUILT (#1044) | `packages/core/src/reports/compute-consent-completeness.ts` (NaN-safe rate) + `countConsentCompleteness` `packages/db/src/stores/prisma-contact-store.ts:405-417`; owner-report tile |
| `missing_consent` exception | BUILT | enum `packages/schemas/src/receipted-booking.ts:18-24`; raised `packages/core/src/receipts/evaluate-exceptions.ts:29-31`; surfaced in the proof-quality worklist (#1074/#1088) |
| Consent reference in the proof chain (`consent_id`) | BUILT (as locked) | `ReceiptedBookingView.consentGrantedAt/consentRevokedAt` snapshot from `Contact` at read time (`packages/db/src/stores/prisma-receipted-booking-store.ts` getView). `consent_id` resolves to the Contact PDPA snapshot, not a separate record (locked decision) |
| Send-enforcement | BUILT | `evaluateProactiveSendEligibility` `packages/core/src/notifications/proactive-eligibility.ts:39-88` (blocks pending/revoked + 24h window + template approval); skill hook `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`; inbound flip `consent-enforcement-gate.ts` |
| Booking-enforcement ("no booking without permission control") | BUILT, flag-gated default-off (#1039 / F15) | `enforceConsentPrecondition` `packages/core/src/skill-runtime/tools/calendar-book-consent.ts`; wired pre-write in `calendar-book.ts`; flag `governanceConfig.consentState.mode` (`packages/schemas/src/governance-config.ts:76-87`, default `off`); adapter `apps/api/src/bootstrap/skill-mode.ts` |
| Automated identity matcher | NOT BUILT (deferred) | only manual `flag_duplicate` via `receipt.reconcile_booking` (#1108); `duplicateContactRisk` hardcoded `false` at issuance; no `@@unique` on `(organizationId, phoneE164)` |
| Broader intake completeness | NOT BUILT (optional) | only consent-completeness exists; no composite contact-readiness score |

## The four product forks, resolved

### (a) The consent object: CONFIRM Contact PDPA fields, not a `ConsentRecord`

Confirmed against ground truth. The locked decision (`project_revenue_proof_direction`) holds: the
canonical consent reference is the **Contact PDPA timestamp snapshot**, not a separate consent
record. The proof chain already references it: `evaluateExceptions` reads `consentGrantedAt` /
`consentRevokedAt`, and `ReceiptedBookingView` snapshots both. The thesis `consent_id` is
therefore the contact's consent state at action time (jurisdiction + grant/revoke timestamps +
source + actor + disclosure version), which is auditable via `consentSource`, `consentUpdatedBy`,
`consentNotes`, `aiDisclosureVersionShown`, and the WorkTrace of the grant/revoke intent.

- **Channel-scoping**: `consentSource` tags the channel of each consent action. A genuinely
  per-channel consent *state* (separate WhatsApp vs SMS vs IG grant/revoke rows) is **not built
  and not needed for v1**: PDPA data-subject consent is contact-level, and the channel-specific
  send permissions (A2P 10DLC, WhatsApp opt-in) are already carried by the separate
  `messagingOptIn` family (`schema.prisma:1798-1801`) and enforced by the 24h-window gate. A
  per-channel consent model is a future Casey v2 item if a customer's compliance posture demands
  it; do not build speculatively.
- **Seller-scoping**: org-scoping is seller-scoping. Every consent read/write leg is keyed on
  `organizationId`; one org is one seller (clinic) at the pilot grain. A sub-org seller dimension
  is unnecessary until a multi-location/franchise tenant exists.

### (b) Intake completeness: the compliance-critical signal is built; broader score deferred

`computeConsentCompleteness` (#1044) is the intake signal the proof chain needs: "bookable" =
contacts with `pdpaJurisdiction` set; "validConsent" = granted and not revoked. The
`missing_consent` exception raises per-booking and drives the owner worklist. That is the
intake-completeness leg Casey owns, and it is built.

A **broader** intake-completeness score (name + phone/email + service interest + jurisdiction
rolled into one readiness number) does not exist. It is **optional and low-leverage**: it does
not strengthen the consent leg of the proof chain, and "bookable" is already defined. If an
operator dashboard later wants a single contact-readiness number, it is a small, read-only,
non-stop-glob slice (a pure `computeIntakeCompleteness` over existing `Contact` columns feeding a
report tile), and can be picked up then. Not in v1.

### (c) The automated identity matcher: DEFER to its own kickoff

Out of Casey v1 scope. Reasoning:

1. **Lowest leverage.** `duplicate_contact_risk` is the rarest, most conservative exception code,
   and it is a proof-*quality* refinement, never a proof-chain gate. The north-star metric
   (weekly receipted bookings) barely moves. The existing manual `flag_duplicate` + reconcile
   path covers the operator-driven case.
2. **Most collision-prone seam.** It sits on the contact/identity seam that memory and the parent
   brief both flag as collision-prone; it would also trip the governance/intent and contact-seam
   merge-stop globs.
3. **Genuine product/compliance decision.** A safe matcher in a PHI-adjacent context can only
   ever *flag* (or *propose* a merge for human review), never auto-merge patient records. The
   match key, threshold, false-positive tolerance, and flag-vs-propose policy are decisions only
   the owner/compliance side can make (see "Open decisions"). This is a named loop stop reason:
   "the next slice needs a product/compliance decision only the user can make."

### (d) Enforcement vs measurement: BOTH already exist; gating policy is Quinn-lite

Casey v1 needs no new gate. Both legs ship:

- **Measurement**: `missing_consent` exception + the consent-completeness read.
- **Send-enforcement**: `evaluateProactiveSendEligibility` + the PDPA skill hook block proactive
  sends on pending/revoked consent (and the 24h window + template approval).
- **Booking-enforcement**: F15 `enforceConsentPrecondition` blocks a booking under `enforce` mode
  (fail-closed, non-retryable `CONSENT_REQUIRED`, writes nothing) when consent is pending or
  revoked. This is the spec's literal "no booking without permission control."

The **decision** of whether a missing-consent booking should hard-block vs route to manager
approval vs escalate is Quinn-lite's charter (policy/approvals/escalation), which is the next MVP
agent after Casey. Casey provides the consent state, the signals, and the off/observe/enforce
mechanism; Quinn-lite later owns the per-org policy. Casey v1 must not depend on Quinn-lite, and
it does not.

## Go-live lever (operational, not a build)

To turn on Casey's consent enforcement for a clinic, no code ships. The owner/operator path is:

1. Populate consent via the existing `operator.grant_consent` intent (or the inbound consent
   capture surfaces) so `consentGrantedAt` and `pdpaJurisdiction` are set for the contact cohort.
2. Roll out the booking + send gates per org by setting `governanceConfig.consentState.mode`:
   `off` (default, inert) -> `observe` (telemetry-only, no blocks) -> `enforce` (hard-block
   pending/revoked). The same sub-block governs the outbound PDPA gate, so one flip moves both.
3. AI-disclosure copy versions are pinned in `AI_DISCLOSURE_VERSIONS` (`pdpa-consent.ts`):
   `sg-disclosure@1.0.0`, `my-disclosure@1.0.0`.

This is the highest-leverage Casey action available today and it is a configuration decision, not
an engineering slice.

## Independent review findings (2026-06-17)

A fresh-context review of the machinery above (verifying "does it actually work end to end")
confirmed the determination is sound and surfaced three gaps. None reopens the design; the consent
leg is still substantially built. Dispositions:

1. FIXED: the canonical `ContactConsentReader.read()` was not org-scoped
   (`findUnique({ where: { id } })`), so the admin `GET /api/admin/consent/:contactId` route
   leaked another tenant's consent record (including `consentNotes`) by contactId, and the booking
   gate plus the outbound hook read through the same un-scoped reader. Fixed in PR #1134 (org-scope
   the reader plus thread orgId at all three call sites; TDD). **Land #1134 before flipping any org
   to `consentState.mode=enforce`**, because enforce mode is exactly when bookings start reading
   consent through that reader.
2. DECISION NEEDED: `meta.lead.greeting.send` (the first-touch WhatsApp greeting to a new Meta
   lead) sends a template with no consent-eligibility check, so proactive-send coverage is not
   total. For CTWA leads the ad click is the opt-in, but the code sends unconditionally. Decide
   whether the first-touch greeting must pass the eligibility gate or is a deliberate
   `not_applicable` allow. Touches an external send path, so its own slice.
3. FOLLOW-UP: the `missing_consent` receipt exception is jurisdiction-blind
   (`evaluate-exceptions.ts` raises it whenever consent is absent or revoked), while the
   completeness report scopes "bookable" to `pdpaJurisdiction != null` and the booking gate allows
   `not_applicable`. A no-jurisdiction contact therefore gets a `missing_consent` flag the matching
   report and gate would not. Small consistency fix (guard the push on jurisdiction).

## Open decisions (for the deferred identity-matcher kickoff)

When the identity matcher is picked up as its own product kickoff, these must be answered first
(they are compliance/product calls, not engineering defaults):

1. **Match key**: exact `phoneE164` only? add exact lowercased `email`? any fuzzy name match
   (high false-positive risk in a clinic)? Recommended v1: exact `phoneE164` and/or exact
   `email`, no fuzzy name.
2. **Action on match**: flag `duplicate_contact_risk` only (recommended), propose a merge for
   human review, or auto-merge. **Never auto-merge patient records without human review** in a
   PHI context.
3. **False-positive tolerance**: a wrongly merged or wrongly flagged patient is a clinical/
   privacy harm, not a CRM annoyance. Sets the threshold and the human-in-the-loop requirement.
4. **Consumption seam**: feed the existing persisted `duplicate_contact_risk` reconcile array
   (the read path already unions open entries into `getView`), so the matcher reuses the shipped
   write-side rather than adding a parallel control plane.

## Out of scope

- Quinn-lite (block/approve/escalate policy), Robin (recovery/show-rate), Mira (creative). Each
  is its own product kickoff per the MVP order Ledger-lite -> Casey -> Quinn-lite -> Robin.
- A per-channel consent *state* model (Casey v2 if a customer compliance posture requires it).
- The automated identity matcher and the broader intake-completeness score (deferred per above).

## Non-negotiables (inherited, for any future Casey slice)

PlatformIngress is the only mutating entry; WorkTrace stays canonical; the receipted-booking
read-model is never a parallel control plane. Layering schemas L1 -> core L3 (no db) -> db L4 ->
apps L5. Every consent read/write leg org-scoped. NaN-safe math. Any flag-gated control ships
with its producer population in the same PR, tested from real producer defaults. Schema change
implies a migration in the same commit. Governed consent mutations use
`operator_mutation` + `system_auto_approved` (resolves platform-direct). No em-dashes.
