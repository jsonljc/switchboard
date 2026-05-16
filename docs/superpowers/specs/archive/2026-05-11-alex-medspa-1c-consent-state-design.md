# Alex SG/MY Medspa — Phase 1c: PDPA Consent State & Outbound Gate

**Date:** 2026-05-11
**Status:** Draft (post-brainstorm, pre-plan)
**Parent spec:** `docs/superpowers/specs/2026-05-10-alex-medspa-sg-my-design.md` (§5 PDPA consent state, Phasing 1c row, Operability)
**Builds on:** Phase 1a (`docs/superpowers/plans/2026-05-10-alex-medspa-phase-1a.md`, PR #409), Phase 1b-1 (`docs/superpowers/specs/2026-05-10-alex-medspa-1b1-deterministic-gate-design.md`, PR #429), and Phase 1b-2 (`docs/superpowers/specs/2026-05-11-alex-medspa-1b2-claim-classifier-design.md`, PR #431). 1a/1b-1/1b-2 must be on the working branch before 1c implementation begins. Spec and plan can be authored against these as references without all being merged.

## Problem

Phases 1b-1 and 1b-2 ship the regulatory safety guards on Alex's _content_: banned-phrase blocks, escalation triggers, and the claim classifier with substantiation tiers. What's still missing is regulatory governance over _who Alex is allowed to talk to_ and _under what consent posture_.

In Singapore and Malaysia, talking to a lead on WhatsApp or IG DM involves two distinct regulatory regimes that are not addressed by content guards:

- **Singapore PDPC's 2024 AI advisory** frames AI disclosure as a transparency control — the data subject should know they are communicating with an AI. Statute-grade compliance is not yet codified, but the defensible operator posture is to disclose, version the disclosure copy, and audit when each contact saw which version.
- **Malaysia PDPA** requires explicit consent before personal-data processing for marketing communications. Revocation by the data subject must be honored deterministically; the system must distinguish operational replies (responsive to an inbound) from non-operational outbound (proactive marketing/re-engagement) when blocking under "consent not granted".

Phase 1c ships the consent state plumbing those regimes require:

- **PDPA consent state** as first-class data on `Contact` (the data subject) — jurisdiction-tagged grant/revoke timestamps + source + actor metadata. Distinct from the existing `Contact.messagingOptIn` field, which is WhatsApp-channel 24h-template consent (Meta requirement, not PDPA).
- **Versioned AI disclosure** as a TS constant per jurisdiction. The skill is instructed (via SKILL.md and `references/regulatory/*`) to include the disclosure in its first governed outbound. The runtime hook detects whether the disclosure substring was included, stamps `Contact.aiDisclosureShownAt` + `aiDisclosureVersionShown`, and emits an observe-only warning verdict if expected but missing. Disclosure validation is telemetry, never a block.
- **`PdpaConsentGateHook`** in the skill-runtime hook chain after the 1b-2 classifier and before trace persistence. Calls a canonical `evaluateConsentGate` helper. In 1c, in-session replies always evaluate as `messageClass: "operational"` and pass; the hook's hard-block surface is mostly inert until Phase 1d wires proactive sends to the same helper. Defense-in-depth blocks the rare race where revocation lands between gateway intake and skill emission.
- **Inbound revocation detection** in the channel-gateway via narrow keyword tables (`"STOP"`, `"unsubscribe"`, `"berhenti"`, etc.), running _before_ the 1b-1 escalation-trigger gate so a user revocation coupled with adverse-reaction language honors revocation first.
- **`ConsentService`** as the sole mutation seat for consent state. Owns invariants: revocation precedence, idempotent revocation, jurisdiction immutability, disclosure-from-consent structural separation. Service-side mutations write `GovernanceVerdict` rows so audit history lives in the existing verdict store; `Contact` carries only current state.
- **Admin endpoint** (`/api/admin/consent/*`) for operator-recorded grants, revocations, and admin-only consent-cycle reset. Phase 2 dashboard surface builds against this endpoint; 1c ships the endpoint without UI.

The architecture preserves the 1b-1/1b-2 discipline: every governance concern is its own hook with its own mode field; verdict shape is canonical across guards; trace store records only the final post-gate output.

## Scope

**In scope (Phase 1c):**

1. **`Contact` schema extension** — eight nullable PDPA-consent fields + two indexes. One Prisma migration. Existing rows unaffected.
2. **`@switchboard/schemas` additions** — `PdpaJurisdictionSchema`, `ConsentStatusSchema`, `ConsentSourceSchema`, `ContactConsentStateSchema`, `AI_DISCLOSURE_VERSIONS` constant, `ConsentStateConfigSchema` + `resolveConsentStateConfig` helper, `evaluateConsentGate` canonical helper, `deriveConsentStatus` read helper, `MessageClass` type, `ConsentGateDecision` type.
3. **`GovernanceVerdictReasonSchema` extensions** — `consent_pending`, `consent_revoked`, `disclosure_not_shown`, `disclosure_version_outdated`, `consent_cycle_reset`, `jurisdiction_mismatch`.
4. **`ConsentService`** in `packages/core/src/consent/` — single mutation authority with five methods (`recordDisclosureShown`, `recordGrant`, `recordRevocation`, `clearConsent`, `attachToGovernedInteraction`) and an internal `ensureJurisdictionStamped` helper. Throws `ConsentJurisdictionMismatch` and `ConsentRevokedCannotRegrant`. Every mutation emits a `GovernanceVerdict`.
5. **Disclosure copy module** in `packages/core/src/consent/disclosure-copy.ts` — per-jurisdiction `{ version, text }` records, conservative seed copy with regulatory-review handoff comment.
6. **Revocation keyword tables** in `packages/core/src/consent/revocation-keywords/` — `common.ts` + `sg.ts` + `my.ts` + `loader.ts`, mirroring 1b-1 banned-phrase pattern.
7. **`PdpaConsentGateHook`** in `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts` — registers after `ClaimClassifierHook` and before `TracePersistenceHook` in the runtime hook chain. Own `GovernancePostureCache` instance (1c-mode scoped; shared with gateway revocation scanner; NOT shared with 1b-1 or 1b-2 caches).
8. **Gateway revocation scanner** — private method on `ChannelGateway`, inserted between identity resolution and the 1b-1 escalation-trigger gate. Runs _before_ the 1b-1 escalation gate.
9. **Admin endpoint** at `apps/api/src/routes/admin-consent.ts` — four routes (`grant`, `revoke`, `clear`, GET state). Existing admin auth middleware. Zod-validated bodies. Error mapping: `ConsentJurisdictionMismatch` → 400, `ConsentRevokedCannotRegrant` → 409 with hint, `ContactNotFound` → 404.
10. **Bootstrap wiring** in `apps/api/src/bootstrap/skill-mode.ts` — construct `ConsentService`, `consentPostureCache`, `PdpaConsentGateHook`; wire gateway revocation scanner deps.
11. **Test fixtures** asserted against `GovernanceVerdict` shape per the 1a/1b-1/1b-2 pattern.

**Out of scope (deferred, do not bleed in):**

- Phase 1d — WhatsApp 24h window detection, template registration, proactive sender (`messageClass: "proactive"` call site).
- Phase 2 — operator dashboard surface for consent state, revocation history, disclosure timeline.
- Phase 3 — outcome tagging, pattern detection on consent-revoked conversations.
- Marketing-vs-data-processing two-axis consent (folded into single grant/revoke timestamp pair).
- Re-grant after revocation by user text (admin `clearConsent` resets cycle).
- Hardened (non-substring) disclosure detection — v1 deterministic heuristic only.
- Revocation-intent classifier (1b-1 escalation triggers handle nuanced complaints).
- Multi-deployment jurisdiction reconciliation per Contact.
- Multi-match revocation analytics (`matches[0]` only).
- Dashboard UI for admin endpoints.
- Persistent / cross-instance posture cache (per-process, same trade-off as 1b-1/1b-2).
- Versioned consent copy stored on Contact (audit-trail via verdict `details`).

## Architecture summary

One new runtime hook + one new gateway pre-input check + one new service + four new admin routes. Hook chain ordering:

```
                  ┌────────────────────────────────────────────────────────┐
inbound ──────────►│ channel-gateway: identity resolve                    │
                  │   ├─ revocation-keyword scanner                       │ ← NEW (1c)
                  │   │     match? → ConsentService.recordRevocation +   │
                  │   │             deterministic ack; skip downstream   │
                  │   ├─ 1b-1 pre-input escalation-trigger gate          │
                  │   └─ platformIngress.submit() ──► skill runtime      │
                  └────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
                  ┌────────────────────────────────────────────────────────┐
                  │ skill runtime: SkillExecutorImpl                     │
                  │   ├─ DeterministicSafetyGateHook  (1b-1)             │
                  │   ├─ ClaimClassifierHook          (1b-2)             │
                  │   ├─ PdpaConsentGateHook          ← NEW (1c)         │
                  │   │     consent state load + jurisdiction stamp     │
                  │   │     in-session always evaluates "operational"   │
                  │   │     disclosure substring check → stamp/warn     │
                  │   │     defense-in-depth block on revoked race      │
                  │   └─ TracePersistenceHook                            │
                  └────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
                                                            replySink.send()
```

Revocation runs _before_ the 1b-1 escalation gate: a user's `"STOP messaging me, this medication made me dizzy"` is first and foremost a revocation; if escalation fires first, the system accidentally continues engagement flow.

`PdpaConsentGateHook` runs _after_ the 1b-2 classifier so the consent gate sees the post-rewrite text — disclosure substring detection runs against the same string the trace store will record.

## Design decisions

| Decision                                                      | Choice                                                                                                                                                                                                                                                                                            | Rationale                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Consent state location                                        | Per-Contact (jurisdiction-tagged columns on `Contact`)                                                                                                                                                                                                                                            | PDPA tracks the data subject. One consent state per person regardless of channel/thread. `Contact.messagingOptIn` (WhatsApp 24h-template consent) stays separate — different regime.                                                                                                                               |
| Consent status representation                                 | Computed by `deriveConsentStatus` from nullable timestamp/jurisdiction fields; no `consentStatus` column                                                                                                                                                                                          | Revocation precedence enforced by construction: `revokedAt != null` short-circuits to `"revoked"`. A stored status column would risk drift.                                                                                                                                                                        |
| Marketing vs data-processing axis                             | Collapsed to a single grant/revoke timestamp pair in 1c                                                                                                                                                                                                                                           | Distinction is meaningful only when proactive marketing-template path exists (1d). Two-axis can be additively introduced later without breaking 1c shape.                                                                                                                                                          |
| Disclosure copy storage                                       | Versioned TS constant per jurisdiction in `@switchboard/schemas` + `packages/core/src/consent/disclosure-copy.ts`                                                                                                                                                                                 | Regulatory artifact, not tenant-customizable. PR review is the change-management surface. Mirrors 1b-2's `CLASSIFIER_PROMPT_VERSION` pattern.                                                                                                                                                                      |
| Disclosure ↔ consent coupling                                 | Structurally separate: no service method writes both; no implicit consent mutation as side-effect of disclosure recording                                                                                                                                                                         | Disclosure shown ≠ consent granted. Disclosure outdated ≠ revoke. Disclosure missing must never mutate consent state — only emit verdicts. Enforced by method signatures and a dedicated test suite.                                                                                                               |
| Jurisdiction stamp                                            | First-write-wins; immutable after first non-null write in v1. Stamped via internal `ensureJurisdictionStamped` invoked by `attachToGovernedInteraction`, `recordGrant`, `recordRevocation` — NEVER by `recordDisclosureShown`                                                                     | Disclosure-driven jurisdiction stamping would couple a communication artifact (disclosure rendering) with governance identity (jurisdiction). A render bug, preview env, or dry-run could permanently stamp jurisdiction before a real governed interaction. Intentional enrollment seat keeps the boundary clean. |
| Non-operational outbound scope                                | Defined as proactive sends (Phase 1d territory). In-session replies in 1c are always operational and pass the gate                                                                                                                                                                                | Smaller 1c scope. The gate's plumbing (canonical helper, posture cache, verdict emission, hook wiring) is ready for 1d; the hard-fire surface is mostly inert in 1c except for the defense-in-depth revoked block.                                                                                                 |
| Re-grant after revocation                                     | Not supported via user text. Admin `clearConsent` resets the cycle explicitly                                                                                                                                                                                                                     | Revocation must be deterministic and irreversible by user inbound. Implicit consent resurrection semantics are unsafe early.                                                                                                                                                                                       |
| Revocation idempotency                                        | Second `recordRevocation` is a no-op (first timestamp preserved)                                                                                                                                                                                                                                  | Prevents timestamp drift from STOP-said-twice, channel race, retry replay.                                                                                                                                                                                                                                         |
| Revocation detection                                          | Inbound keyword scanner (narrow conservative seed) + operator-recorded admin path                                                                                                                                                                                                                 | False-positive revoke is worse than missed revoke (silently flipping a willing customer to revoked > missing a paraphrased revocation that 1b-1 escalation catches anyway). Model classifier rejected for 1c — overreach.                                                                                          |
| Revocation scanner ordering                                   | Runs _before_ the 1b-1 escalation gate in the channel-gateway                                                                                                                                                                                                                                     | A user saying `"STOP"` coupled with medical-safety language is first and foremost a revocation. If escalation fires first, system accidentally continues engagement flow.                                                                                                                                          |
| Disclosure detection mechanism                                | Substring match (`result.response.includes(DISCLOSURE_COPY[jurisdiction].text)`)                                                                                                                                                                                                                  | v1 deterministic heuristic, not compliance-proof validation. Punctuation / whitespace / markdown drift breaks this — caught by regression test. Hardened detection deferred until disclosure copy stabilizes.                                                                                                      |
| Disclosure-validation severity                                | Observe-only `auditLevel: "warning"` even in enforce mode. Never blocks.                                                                                                                                                                                                                          | Disclosure drift must NEVER cause production outage. Tuning signal, not traffic control.                                                                                                                                                                                                                           |
| Gate placement                                                | New `PdpaConsentGateHook` after `ClaimClassifierHook`, before `TracePersistenceHook`. Own posture-cache instance.                                                                                                                                                                                 | Mirrors 1b-1/1b-2 pattern — independent hook per governance concern, independent feature flag rollout, independent verdict-stamping.                                                                                                                                                                               |
| Posture-cache scoping                                         | One shared instance between the gateway revocation scanner and the runtime hook (both consult `governanceConfig.consentState.mode`). NOT shared with 1b-1's `deterministicGate.mode` cache or 1b-2's `claimClassifier.mode` cache.                                                                | 1b-2 established per-field cache instances to avoid cross-mode overwrite. Sharing within the same mode field is safe (and warms both gates with one DB read). Three distinct cache instances total in bootstrap: deterministicGate, claimClassifier, consentState.                                                 |
| `evaluateConsentGate` jurisdiction handling                   | Matrix is jurisdiction-agnostic in the gate. PDPA's substantive difference between SG (deemed consent, disclosure-as-transparency-control) and MY (explicit consent before processing) is expressed by WHEN the skill / 1d sender requests grant capture, not by branching policy inside the gate | Keeps the helper testable as a pure function. Avoids turning the gate into a compliance rules engine.                                                                                                                                                                                                              |
| `ConsentJurisdictionMismatch` runtime handling (hook surface) | Hook does not block in 1c. Emits `auditLevel: "critical"` verdict with `reasonCode: "jurisdiction_mismatch"` + console.error                                                                                                                                                                      | Mismatch is data integrity divergence, not a "missing config" — elevated severity ensures visibility. Blocking on it in 1c would be overreach (Contact across two governed deployments is not yet a real topology).                                                                                                |
| `ConsentJurisdictionMismatch` admin-endpoint handling         | Returns 400 with `{ stamped, provided }` body                                                                                                                                                                                                                                                     | Operator-visible error — they should fix the input, not silently retry.                                                                                                                                                                                                                                            |
| Audit history storage                                         | `GovernanceVerdict` rows are the audit ledger. `Contact` carries only current state.                                                                                                                                                                                                              | Mirrors 1b-1/1b-2: trace store records emitted output; verdict store is the regulated artifact. No new audit-history table.                                                                                                                                                                                        |
| Hook output contract                                          | `PdpaConsentGateHook` operates on `result.response` as the **final pre-trace outbound text**. Hook ordering invariant: any future post-render transformation MUST register before this hook in the chain                                                                                          | Disclosure detection and revoked-defense verdicts reflect the canonical outbound text. Codified by a hook-ordering test.                                                                                                                                                                                           |

## Section 1 — Schema

### 1.1 `Contact` extensions (Prisma)

`packages/db/prisma/schema.prisma`:

```prisma
model Contact {
  // ...existing fields...

  // PDPA consent state (Phase 1c). Jurisdiction-tagged data-subject consent.
  // Distinct from `messagingOptIn` which is WhatsApp-channel template-send consent.
  // pdpaJurisdiction is immutable after first non-null write in v1 — only ConsentService
  // mutates these fields, and the service throws ConsentJurisdictionMismatch on any
  // attempt to write a different jurisdiction.
  pdpaJurisdiction         String?     // "SG" | "MY" — stamped at first governed interaction
  consentGrantedAt         DateTime?
  consentRevokedAt         DateTime?
  consentSource            String?     // see ConsentSourceSchema
  aiDisclosureVersionShown String?     // e.g., "sg-disclosure@1.0.0"
  aiDisclosureShownAt      DateTime?
  consentUpdatedBy         String?     // userId or "system:inbound_keyword_revocation" / "system:skill_runtime"
  consentNotes             String?     @db.Text

  @@index([organizationId, pdpaJurisdiction, consentRevokedAt])
  @@index([organizationId, pdpaJurisdiction, consentGrantedAt])
}
```

All eight fields nullable. Existing Contact rows are unaffected — the gate treats null `pdpaJurisdiction` as "no governance" and passes through.

Migration steps (use `prisma migrate diff --from-url --to-schema-datamodel --script` then `migrate deploy`, per the established TTY-free workflow):

1. `ALTER TABLE "Contact" ADD COLUMN ...` for each of the eight fields.
2. `CREATE INDEX` for the two composite indexes.

No data backfill. `pnpm db:check-drift` must pass before commit. If Postgres is unreachable in the spec author's environment, follow the 1a/1b-1/1b-2 pattern: skip locally and document in the PR body.

### 1.2 Derived consent status

```ts
// packages/schemas/src/pdpa-consent.ts
export type ConsentStatus = "not_applicable" | "pending" | "granted" | "revoked";

export function deriveConsentStatus(c: {
  pdpaJurisdiction: "SG" | "MY" | null;
  consentGrantedAt: Date | null;
  consentRevokedAt: Date | null;
}): ConsentStatus {
  if (!c.pdpaJurisdiction) return "not_applicable";
  if (c.consentRevokedAt) return "revoked";
  if (c.consentGrantedAt) return "granted";
  return "pending";
}
```

Revocation precedence enforced by construction (`revokedAt` short-circuits before `grantedAt` is consulted). Re-grant after revocation is not supported by this function — requires admin `clearConsent` first.

### 1.3 Schema package additions

`packages/schemas/src/pdpa-consent.ts` (new file):

```ts
import { z } from "zod";

export const PdpaJurisdictionSchema = z.enum(["SG", "MY"]);
export type PdpaJurisdiction = z.infer<typeof PdpaJurisdictionSchema>;

export const ConsentStatusSchema = z.enum(["not_applicable", "pending", "granted", "revoked"]);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

export const ConsentSourceSchema = z.enum([
  "whatsapp_quick_reply",
  "ig_dm_reply",
  "web_form",
  "operator_recorded",
  "inbound_keyword_revocation",
  "operator_recorded_revocation",
]);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

export const ContactConsentStateSchema = z.object({
  pdpaJurisdiction: PdpaJurisdictionSchema.nullable(),
  consentGrantedAt: z.string().datetime().nullable(),
  consentRevokedAt: z.string().datetime().nullable(),
  consentSource: ConsentSourceSchema.nullable(),
  aiDisclosureVersionShown: z.string().nullable(),
  aiDisclosureShownAt: z.string().datetime().nullable(),
  consentUpdatedBy: z.string().nullable(),
  consentNotes: z.string().nullable(),
});
export type ContactConsentState = z.infer<typeof ContactConsentStateSchema>;

/** Versioned per-jurisdiction AI disclosure copy. Stamped onto Contact when shown. */
export const AI_DISCLOSURE_VERSIONS = {
  SG: "sg-disclosure@1.0.0",
  MY: "my-disclosure@1.0.0",
} as const;

// --- canonical gate helper (Section 3.1) ---

export type MessageClass = "operational" | "proactive";

export type ConsentGateDecision =
  | { action: "allow"; status: ConsentStatus }
  | { action: "block"; status: ConsentStatus; reasonCode: "consent_pending" | "consent_revoked" };

/**
 * Single source of truth for "can this outbound class go out, given this
 * Contact's consent state?". Imported by:
 *   - PdpaConsentGateHook (in-session; always passes messageClass="operational")
 *   - Phase 1d proactive sender (passes messageClass="proactive")
 *   - admin / dashboard preview surfaces
 *
 * Policy matrix (jurisdiction-agnostic — PDPA's SG/MY substantive difference is
 * expressed by WHEN grant capture happens, not by branching here):
 *
 * | messageClass | not_applicable | pending                    | granted | revoked                    |
 * |--------------|----------------|----------------------------|---------|----------------------------|
 * | operational  | allow          | allow                      | allow   | block (consent_revoked)¹   |
 * | proactive    | allow          | block (consent_pending)    | allow   | block (consent_revoked)    |
 *
 * ¹ Defense-in-depth: gateway revocation scanner flips conversation to
 *   human_override which upstream-suppresses bot turns. The hook still blocks
 *   on revoked to catch the rare race where revocation lands between gateway
 *   intake and skill emission.
 */
export function evaluateConsentGate(input: {
  contact: Pick<ContactConsentState, "pdpaJurisdiction" | "consentGrantedAt" | "consentRevokedAt">;
  messageClass: MessageClass;
}): ConsentGateDecision;
```

### 1.4 `governanceConfig.consentState` sub-block

`packages/schemas/src/governance-config.ts` — additive (no Prisma migration of the `governanceConfig` JSON column itself; 1b-1's `.passthrough()` already accepts arbitrary sub-blocks):

```ts
export const ConsentStateConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
  })
  .default({});

export type ConsentStateConfig = z.infer<typeof ConsentStateConfigSchema>;

export function resolveConsentStateConfig(config: GovernanceConfig | null): ConsentStateConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.consentState;
  return ConsentStateConfigSchema.parse(raw ?? {});
}
```

`resolveConsentStateConfig(null)` returns `{ mode: "off" }`. The mode field IS the feature flag, per the 1b-1/1b-2 pattern. No latency-budget or model field — the consent gate is deterministic, no model calls.

### 1.5 `GovernanceVerdictReasonSchema` extensions

```ts
// additions in packages/schemas/src/governance-verdict.ts
"consent_pending",              // NEW (1c): proactive send blocked because grantedAt null
"consent_revoked",              // NEW (1c): inbound keyword revocation OR proactive send blocked post-revoke OR defense-in-depth in-session block
"disclosure_not_shown",         // NEW (1c): expected disclosure substring absent in first outbound (observe-only warning)
"disclosure_version_outdated",  // NEW (1c): Contact.aiDisclosureVersionShown lags current TS constant
"consent_cycle_reset",          // NEW (1c): admin clearConsent
"jurisdiction_mismatch",        // NEW (1c): ConsentService rejected jurisdiction divergence
```

`consent_missing` (reserved in 1a/1b-1) stays unused in 1c — `consent_pending` and `consent_revoked` are more specific. Out of scope to rename `consent_missing`.

`GovernanceVerdictSourceSchema` gets one new value: `"consent_gate"` (already reserved in 1a but never emitted). 1c is the first emitter.

## Section 2 — State machine

State machine (per Contact):

```
                         ┌──────────────────┐
                         │  not_applicable  │  (pdpaJurisdiction = null)
                         └────────┬─────────┘
                                  │ first governed interaction
                                  │ attachToGovernedInteraction() stamps
                                  │ pdpaJurisdiction (immutable after this)
                                  ▼
                         ┌──────────────────┐
              ┌────────► │     pending      │ ◄─────────┐
              │          └────────┬─────────┘            │
   admin      │                   │ recordGrant()        │ clearConsent()
   clearConsent│                  ▼                       │ (admin only —
              │          ┌──────────────────┐            │  starts new cycle)
              │          │     granted      │            │
              │          └────────┬─────────┘            │
              │                   │ recordRevocation()   │
              │                   ▼                       │
              │          ┌──────────────────┐            │
              └──────────┤     revoked      │────────────┘
                         └──────────────────┘
                          (irreversible by user text)
```

**Locked invariants** (asserted in `ConsentService` and in tests):

- `pdpaJurisdiction` is immutable after first non-null write. Service throws `ConsentJurisdictionMismatch` on any attempt to write a different jurisdiction; comment lives on the Prisma field.
- `consentRevokedAt` overrides all reads — never compared against `consentGrantedAt` for "most recent wins" semantics. Revocation wins by construction.
- `consentGrantedAt` cannot be set while `consentRevokedAt` is non-null (service throws `ConsentRevokedCannotRegrant`). Re-grant requires `clearConsent` first.
- Disclosure fields (`aiDisclosureVersionShown`, `aiDisclosureShownAt`) are **structurally orthogonal** to consent timestamps. The service has no method that mutates a disclosure field as a side-effect of a consent transition, and no method that mutates a consent timestamp as a side-effect of a disclosure write. Enforced by separate method signatures; asserted by a dedicated test set.

## Section 3 — `ConsentService`

### 3.1 Interface

`packages/core/src/consent/consent-service.ts`:

```ts
export interface ConsentService {
  /** Stamp pdpaJurisdiction if currently null. No-op otherwise (or throws
   *  ConsentJurisdictionMismatch if a different jurisdiction is stamped).
   *  Does NOT touch consent timestamps or disclosure fields. Called by the
   *  gateway and the runtime hook at the start of governed turns. */
  attachToGovernedInteraction(contactId: string, jurisdiction: PdpaJurisdiction): Promise<void>;

  /** Stamp disclosure shown. No-op if already stamped with the same version.
   *  Version bump writes a `disclosure_version_bumped` info verdict. Does NOT
   *  touch consent timestamps. Does NOT stamp jurisdiction (the gateway / hook
   *  call attachToGovernedInteraction first). */
  recordDisclosureShown(input: {
    contactId: string;
    jurisdiction: PdpaJurisdiction;
    version: string;
    shownAt: Date;
    actor: string; // e.g., "system:skill_runtime"
  }): Promise<void>;

  /** Record explicit consent grant. Throws ConsentRevokedCannotRegrant if
   *  consentRevokedAt is already set. Calls ensureJurisdictionStamped internally. */
  recordGrant(input: {
    contactId: string;
    jurisdiction: PdpaJurisdiction;
    source: Extract<
      ConsentSource,
      "whatsapp_quick_reply" | "ig_dm_reply" | "web_form" | "operator_recorded"
    >;
    grantedAt: Date;
    actor: string;
    notes?: string;
  }): Promise<void>;

  /** Record revocation. Idempotent — second call is a no-op (does NOT overwrite
   *  the first revocation timestamp). Calls ensureJurisdictionStamped internally.
   *  Also flips conversation status to human_override and annotates any open
   *  HandoffPackage with consentRevokedDuringHandoff: true. */
  recordRevocation(input: {
    contactId: string;
    source: Extract<ConsentSource, "inbound_keyword_revocation" | "operator_recorded_revocation">;
    revokedAt: Date;
    actor: string;
    notes?: string;
    openConversationSessionId?: string;
  }): Promise<void>;

  /** Admin-only: clear both consent timestamps to start a fresh cycle.
   *  Requires explicit notes (audit trail). Does NOT clear pdpaJurisdiction
   *  or disclosure fields. Requires a non-"system:" actor. */
  clearConsent(input: { contactId: string; actor: string; notes: string }): Promise<void>;
}
```

### 3.2 Verdict emission policy

Every service method writes a `GovernanceVerdict` (sourceGuard=`consent_gate`):

| Method                                            | reasonCode                | auditLevel | details                                                                            |
| ------------------------------------------------- | ------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `attachToGovernedInteraction` (first stamp)       | `allowed`                 | `info`     | `{ event: "jurisdiction_stamped", jurisdiction }`                                  |
| `attachToGovernedInteraction` (no-op)             | (no verdict — pure no-op) | —          | —                                                                                  |
| `recordDisclosureShown` (first stamp)             | `allowed`                 | `info`     | `{ event: "disclosure_shown", version, jurisdiction }`                             |
| `recordDisclosureShown` (version bump)            | `allowed`                 | `info`     | `{ event: "disclosure_version_bumped", previousVersion, newVersion }`              |
| `recordDisclosureShown` (idempotent same version) | (no verdict — pure no-op) | —          | —                                                                                  |
| `recordGrant`                                     | `allowed`                 | `info`     | `{ event: "consent_granted", source, jurisdiction }`                               |
| `recordRevocation` (first)                        | `consent_revoked`         | `critical` | `{ event: "consent_revoked", source, sessionId?, handoffAnnotated }`               |
| `recordRevocation` (idempotent)                   | (no verdict — pure no-op) | —          | —                                                                                  |
| `clearConsent`                                    | `consent_cycle_reset`     | `warning`  | `{ event: "consent_cleared", previousGrantedAt, previousRevokedAt, actor, notes }` |

### 3.3 Errors

- `ConsentJurisdictionMismatch` — thrown by `ensureJurisdictionStamped` when input jurisdiction differs from stamped jurisdiction. Caller decides whether to swallow (gateway/hook: log + non-blocking critical verdict) or surface (admin endpoint: 400 with `{ stamped, provided }`).
- `ConsentRevokedCannotRegrant` — thrown by `recordGrant` when `consentRevokedAt` is non-null. Admin endpoint maps to 409 with `hint: "POST /api/admin/consent/clear first to start a fresh cycle"`.
- `ContactNotFound` — thrown on missing contact. Admin endpoint maps to 404.

### 3.4 Implementation layout

```
packages/core/src/consent/
  consent-service.ts                  // interface + factory
  consent-service.test.ts             // invariants + verdict emission
  disclosure-copy.ts                  // DISCLOSURE_COPY records + v1-heuristic caveat comment
  errors.ts                           // ConsentJurisdictionMismatch, ConsentRevokedCannotRegrant
  revocation-keywords/
    types.ts
    common.ts
    sg.ts
    my.ts
    loader.ts
    index.ts
  scanner/
    revocation-keyword-scanner.ts     // pure function
  revocation-ack.ts                   // REVOCATION_ACK records per jurisdiction

packages/db/src/
  prisma-consent-store.ts             // Prisma adapter consumed by ConsentService factory
```

## Section 4 — Disclosure copy & revocation tables

### 4.1 Disclosure copy

`packages/core/src/consent/disclosure-copy.ts`:

```ts
import { AI_DISCLOSURE_VERSIONS, type PdpaJurisdiction } from "@switchboard/schemas";

/**
 * Versioned AI disclosure copy per jurisdiction. SG is a transparency
 * disclosure aligned with PDPC's 2024 AI advisory. MY includes the consent
 * prompt because MY PDPA requires explicit consent before personal-data
 * processing.
 *
 * v1 deterministic heuristic, not compliance-proof validation — punctuation,
 * whitespace, and markdown drift will break PdpaConsentGateHook substring
 * detection. Hardened detection deferred until disclosure copy stabilizes.
 *
 * Regulatory-review handoff: conservative seed copy. Named reviewer (TBD per
 * PR template) tightens this before pilot. Same handoff frame as 1b-1.5.
 */
export const DISCLOSURE_COPY: Record<PdpaJurisdiction, { version: string; text: string }> = {
  SG: {
    version: AI_DISCLOSURE_VERSIONS.SG,
    text: "Hi, I'm Alex — the clinic's AI assistant. I can help with bookings and general questions, and a clinic team member will step in for anything medical.",
  },
  MY: {
    version: AI_DISCLOSURE_VERSIONS.MY,
    text: "Hi, I'm Alex — the clinic's AI assistant. To follow up with you and share booking info, the clinic needs your okay to process your details. Reply OK to continue, or STOP at any time to opt out.",
  },
};
```

### 4.2 Revocation keyword tables

`packages/core/src/consent/revocation-keywords/types.ts`:

```ts
export interface RevocationKeywordEntry {
  id: string;
  patterns: ReadonlyArray<string | RegExp>;
  jurisdiction: PdpaJurisdiction | "both";
  notes?: string;
}
```

Same loader / normalization / uniqueness contract as 1b-1's banned-phrase tables:

- Strings are case-insensitive substring matches.
- RegExps normalized at loader boundary (always `i`, never `g`) using the shared `normalizeRegex` utility from 1b-1.
- `id` unique within the merged jurisdiction set; loader asserts at boot.
- Memoized loader output per jurisdiction.

Conservative seed (jurisdiction-tagged):

| Jurisdiction | Patterns                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| both         | `/\bSTOP\b/i`, `/\bunsubscribe\b/i`, `/remove me/i`, `/don't (contact\|message) me/i`, `/opt[- ]?out/i` |
| SG           | `/\bjangan hubungi\b/i`, `/\bcancel\b.*\b(messages?\|whatsapp\|sms)\b/i`                                |
| MY           | `/\bberhenti\b/i`, `/\btarik balik\b/i`, `/\bjangan hantar\b/i`                                         |

False-positive risk on revocation is high-cost (silently flipping a willing customer to revoked is worse than missing a paraphrased revocation, which 1b-1's escalation triggers handle anyway as a fallback). Conservative seed plus regulatory-review expansion (Phase 1c.5) is the right operational posture.

### 4.3 Revocation ack copy

`packages/core/src/consent/revocation-ack.ts`:

```ts
export const REVOCATION_ACK: Record<PdpaJurisdiction, string> = {
  SG: "Got it — we won't message you further. If you change your mind, you can let the clinic team know directly.",
  MY: "Noted — we'll stop messaging you. To opt back in later, please contact the clinic directly.",
};
```

Deterministic. No model. Two jurisdictions ship in 1c. Snapshot-tested.

### 4.4 Revocation scanner

`packages/core/src/consent/scanner/revocation-keyword-scanner.ts`:

```ts
export interface RevocationKeywordMatch {
  entry: RevocationKeywordEntry;
  matched: string;
  index: number;
}

export function scanForRevocationKeywords(
  text: string,
  entries: ReadonlyArray<RevocationKeywordEntry>,
): RevocationKeywordMatch[];
```

Pure function. Returns all matches; caller uses `matches[0]` in 1c (multi-match analytics deferred). Case-insensitive substring + normalized-regex. NOT sentence-bounded (revocation in any sentence of the inbound counts — the user's intent is the message, not the surrounding clauses).

## Section 5 — `PdpaConsentGateHook`

### 5.1 Dependencies and contract

`packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`:

```ts
export interface ContactConsentReader {
  read(contactId: string): Promise<ContactConsentState>;
}

export interface PdpaConsentGateHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  postureCache: GovernancePostureCache; // shared with gateway revocation scanner
  consentService: ConsentService;
  contactConsentReader: ContactConsentReader;
  sessionContactResolver: (sessionId: string) => Promise<string | null>;
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStatusSetter;
  clock: () => Date;
}

export class PdpaConsentGateHook implements SkillHook {
  readonly name = "pdpa-consent-gate";
  constructor(deps: PdpaConsentGateHookDeps);
  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void>;
}
```

Real hook contract (verified against `packages/core/src/skill-runtime/types.ts:224-233`): `name: string` + optional `afterSkill?(ctx, result): Promise<void>`. The hook mutates `result.response` in place (no replacement return value).

### 5.2 Flow inside `afterSkill`

The hook always evaluates `messageClass: "operational"` — in-session replies are by definition operational in 1c. The proactive (`messageClass: "proactive"`) call site is Phase 1d's responsibility, on a separate dispatch path.

```ts
async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
  // 1. Resolve governance config
  const resolution = await governanceConfigResolver(ctx.deploymentId);
  if (resolution.status === "missing") return;
  if (resolution.status === "error") return this.handleResolverError(ctx, result);

  // 2. Resolve sub-block; mode === "off" → pass-through
  const consentConfig = resolveConsentStateConfig(resolution.config);
  if (consentConfig.mode === "off") return;

  // 3. Warm the posture cache
  postureCache.remember(ctx.deploymentId, {
    mode: consentConfig.mode,
    jurisdiction: resolution.config.jurisdiction,
    clinicType: resolution.config.clinicType,
  });

  // 4. Resolve contact (null = pre-contact transient; no-op)
  const contactId = await sessionContactResolver(ctx.sessionId);
  if (!contactId) return;

  // 5. Stamp jurisdiction intentionally (NOT via disclosure path)
  try {
    await consentService.attachToGovernedInteraction(contactId, resolution.config.jurisdiction);
  } catch (err) {
    if (err instanceof ConsentJurisdictionMismatch) {
      // Elevated severity: data integrity divergence, not "missing config"
      console.error("[pdpa-consent-gate] jurisdiction mismatch", err);
      await this.persistJurisdictionMismatchVerdict({ ctx, err, originalText: result.response });
      return;  // do not block in 1c, but skip the rest of the consent logic
    }
    throw err;
  }

  // 6. Read consent state
  const consent = await contactConsentReader.read(contactId);

  // 7. Evaluate the gate
  const decision = evaluateConsentGate({ contact: consent, messageClass: "operational" });

  // 8. Apply decision
  if (decision.action === "block") {
    return this.applyDefenseInDepthBlock({ ctx, result, decision, jurisdiction: resolution.config.jurisdiction });
  }

  // 9. Allow path: disclosure detection (side-effect only; never blocks)
  await this.runDisclosureDetection({ ctx, result, consent, jurisdiction: resolution.config.jurisdiction, mode: consentConfig.mode });
}
```

### 5.3 Disclosure detection (allow path only)

```ts
const expected = DISCLOSURE_COPY[jurisdiction];
// v1 deterministic heuristic, not compliance-proof validation
const includesDisclosure = result.response.includes(expected.text);

if (consent.aiDisclosureShownAt === null) {
  if (includesDisclosure) {
    await consentService.recordDisclosureShown({
      contactId,
      jurisdiction,
      version: expected.version,
      shownAt: clock(),
      actor: "system:skill_runtime",
    });
  } else if (mode === "enforce") {
    // Observe-level warning EVEN IN enforce mode — disclosure drift must
    // never cause production outage. Tuning signal, not traffic control.
    await verdictStore.save({
      sourceGuard: "consent_gate",
      reasonCode: "disclosure_not_shown",
      action: "allow",
      auditLevel: "warning",
      jurisdiction,
      clinicType,
      conversationId: ctx.sessionId,
      decidedAt: clock().toISOString(),
      originalText: result.response,
      details: { expectedVersion: expected.version, sentinelDetected: false },
      deploymentId: ctx.deploymentId,
    });
  }
} else if (consent.aiDisclosureVersionShown !== expected.version) {
  if (includesDisclosure) {
    await consentService.recordDisclosureShown({
      contactId,
      jurisdiction,
      version: expected.version,
      shownAt: clock(),
      actor: "system:skill_runtime",
    });
    // ConsentService writes the disclosure_version_bumped info verdict (Section 3.2).
  } else if (mode === "enforce") {
    await verdictStore.save({
      sourceGuard: "consent_gate",
      reasonCode: "disclosure_version_outdated",
      action: "allow",
      auditLevel: "warning",
      jurisdiction,
      clinicType,
      conversationId: ctx.sessionId,
      decidedAt: clock().toISOString(),
      originalText: result.response,
      details: {
        currentVersion: consent.aiDisclosureVersionShown,
        expectedVersion: expected.version,
        sentinelDetected: false,
      },
      deploymentId: ctx.deploymentId,
    });
  }
}
```

Disclosure detection **never mutates consent state**. The two `consentService.recordDisclosureShown` calls have zero side-effect on consent timestamps (Section 3.1 method signature; Section 5 dedicated test suite).

### 5.4 Defense-in-depth block (revoked race)

When `evaluateConsentGate` returns `block` (consent_revoked) on an in-session reply, the conversation should already be in `human_override` (gateway revocation scanner flipped it on the inbound that triggered revocation). The hook handles the rare race where revocation lands between gateway intake and skill emission:

```ts
// Replace response with handoff template
result.response = renderHandoffTemplate({ jurisdiction, reasonCode: "consent_revoked" });

await verdictStore.save({
  sourceGuard: "consent_gate", reasonCode: "consent_revoked",
  action: "block", auditLevel: "critical",
  jurisdiction, clinicType, conversationId: ctx.sessionId,
  decidedAt: clock().toISOString(),
  originalText: <original>, emittedText: result.response,
  details: { event: "defense_in_depth_revoked_race" },
  deploymentId: ctx.deploymentId,
});
await conversationStore.setConversationStatus(ctx.sessionId, "human_override");
await handoffStore.save(buildHandoffPackage({
  reason: "compliance_concern",
  payload: { event: "consent_revoked_race", sourceGuard: "consent_gate" },
  // ... existing buildHandoffPackage shape from 1b-1
}));
```

### 5.5 Resolver-error handling

Mirrors 1b-1 fail-closed/fail-open semantics scoped to the consent-gate posture:

| Status                                  | Last-known mode | Action                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`, cache miss or last-known `off` | —               | Pass through. Log. No verdict.                                                                                                                                                                                                                                                                 |
| `error`, last-known `observe`           | —               | Pass through. Log. No verdict. (Pass-through is consistent observe-mode behavior.)                                                                                                                                                                                                             |
| `error`, last-known `enforce`           | —               | Fail closed: emit `governance_unavailable` critical verdict using cached posture's jurisdiction + clinicType. Do NOT block result.response in 1c (in-session messageClass="operational" never blocks on consent state alone — only revoked does). The verdict alone is the operational signal. |

### 5.6 `ConsentJurisdictionMismatch` verdict shape

```ts
{
  sourceGuard: "consent_gate", reasonCode: "jurisdiction_mismatch",
  action: "allow", auditLevel: "critical",          // critical severity, but does not block
  jurisdiction: <deployment jurisdiction>, clinicType,
  conversationId: ctx.sessionId, decidedAt: clock().toISOString(),
  details: {
    event: "jurisdiction_mismatch",
    stamped: err.stamped,
    provided: err.provided,
    contactId,
  },
  deploymentId: ctx.deploymentId,
}
```

## Section 6 — Gateway revocation scanner

### 6.1 Insertion point and ordering

`packages/core/src/channel-gateway/channel-gateway.ts`. New private method `scanForConsentRevocation`, called between identity resolution and the 1b-1 escalation-trigger gate. Revocation runs **before** the 1b-1 escalation gate.

### 6.2 Dependencies (added to `ChannelGateway` constructor)

- `governanceConfigResolver: GovernanceConfigResolver` (shared with 1b-1/1b-2/runtime hook — stateless)
- `consentPostureCache: GovernancePostureCache` (shared with `PdpaConsentGateHook`; NOT shared with 1b-1 deterministicGate cache or 1b-2 classifier cache)
- `revocationKeywordLoader: (j: PdpaJurisdiction) => readonly RevocationKeywordEntry[]`
- `consentService: ConsentService` (delegates mutation + status flip + handoff annotation)
- `sessionContactResolver: (sessionId: string) => Promise<string | null>` (shared with hook)
- `verdictStore`, `handoffStore`, `conversationStore`, `replySink` (already present or wired)

### 6.3 Flow

```ts
private async scanForConsentRevocation(ctx: InboundContext): Promise<"revoked" | "proceed"> {
  const resolution = await this.governanceConfigResolver(ctx.deploymentId);
  if (resolution.status === "missing") return "proceed";
  if (resolution.status === "error") return this.handleConsentResolverError(ctx);

  const consentConfig = resolveConsentStateConfig(resolution.config);
  if (consentConfig.mode === "off") return "proceed";

  this.consentPostureCache.remember(ctx.deploymentId, {
    mode: consentConfig.mode,
    jurisdiction: resolution.config.jurisdiction,
    clinicType: resolution.config.clinicType,
  });

  const entries = this.revocationKeywordLoader(resolution.config.jurisdiction);
  const matches = scanForRevocationKeywords(ctx.inboundText, entries);
  if (matches.length === 0) return "proceed";

  const contactId = await this.sessionContactResolver(ctx.sessionId);
  if (!contactId) return "proceed";  // pre-contact inbound; nothing to revoke

  if (consentConfig.mode === "observe") {
    // Telemetry only — no state mutation, no ack, no status flip
    await this.verdictStore.save({
      sourceGuard: "consent_gate", reasonCode: "consent_revoked",
      action: "allow", auditLevel: "warning",
      jurisdiction: resolution.config.jurisdiction,
      clinicType: resolution.config.clinicType,
      conversationId: ctx.sessionId, decidedAt: this.clock().toISOString(),
      originalText: ctx.inboundText,
      details: {
        observe: true,
        matchId: matches[0].entry.id,
        matchedText: matches[0].matched,
      },
      deploymentId: ctx.deploymentId,
    });
    return "proceed";
  }

  // enforce: service owns mutation + verdict + status flip + handoff annotation
  await this.consentService.recordRevocation({
    contactId,
    source: "inbound_keyword_revocation",
    revokedAt: this.clock(),
    actor: "system:inbound_keyword_revocation",
    notes: `keyword=${matches[0].entry.id}, matched="${matches[0].matched}"`,
    openConversationSessionId: ctx.sessionId,
  });

  // Gateway owns the user-facing acknowledgment
  await this.replySink.send(REVOCATION_ACK[resolution.config.jurisdiction]);
  return "revoked";
}
```

If `scanForConsentRevocation` returns `"revoked"`, the gateway skips both the 1b-1 escalation gate and `platformIngress.submit()`. Otherwise proceeds to the 1b-1 escalation gate.

### 6.4 Handoff annotation on open conversations

`ConsentService.recordRevocation` checks for an open `HandoffPackage` on `openConversationSessionId`. If found, it annotates the package's `details` with `consentRevokedDuringHandoff: true` + the revocation timestamp. Does NOT close the handoff or suppress operator replies — the operator decides whether to send a final operational reply (allowed under most PDPA reads) or close. A human is already in the loop.

## Section 7 — Hook registration & bootstrap

`apps/api/src/bootstrap/skill-mode.ts`:

1. Construct `ConsentService` (Prisma adapter via `packages/db/src/prisma-consent-store.ts`, plus `verdictStore`, `handoffStore`, `conversationStore`).
2. Construct `consentPostureCache` (separate `InMemoryGovernancePostureCache` instance — distinct from the 1b-1 and 1b-2 cache instances).
3. Construct `PdpaConsentGateHook` with deps. Insert in the runtime hook array **after** `ClaimClassifierHook` and **before** `TracePersistenceHook`.
4. Wire revocation scanner deps into `ChannelGateway` constructor: `revocationKeywordLoader`, `consentService`, `consentPostureCache`, `sessionContactResolver`.
5. `ChannelGateway` revocation scan call site is inserted **before** the 1b-1 escalation scan.

`sessionContactResolver` is a thin adapter: `(sessionId) => prisma.conversationThread.findUnique({ where: { sessionId }, select: { contactId: true } }).then(t => t?.contactId ?? null)`. Returns null pre-contact; both gateway and hook handle null as a no-op.

**Hook ordering invariant (test-asserted):** `PdpaConsentGateHook` must be the last hook in the runtime chain before `TracePersistenceHook`. Any future post-render transformation (formatting, localization wrappers, transport normalization) MUST register **before** `PdpaConsentGateHook` in the chain, not after. A test fails if a new hook is registered between `PdpaConsentGateHook` and `TracePersistenceHook`. This invariant exists because disclosure substring detection and the revoked defense-in-depth verdict operate on `result.response` as the canonical pre-trace text — anything that mutates the string after this hook silently invalidates both detections.

## Section 8 — Admin endpoint

`apps/api/src/routes/admin-consent.ts` (single new route file). Auth via the existing admin auth middleware.

```
POST   /api/admin/consent/grant      ConsentService.recordGrant
POST   /api/admin/consent/revoke     ConsentService.recordRevocation (source: operator_recorded_revocation)
POST   /api/admin/consent/clear      ConsentService.clearConsent
GET    /api/admin/consent/:contactId Returns ContactConsentState + derived status
```

Bodies Zod-validated. Error mapping:

- `ConsentJurisdictionMismatch` → 400 with `{ error: "jurisdiction_mismatch", stamped, provided }`
- `ConsentRevokedCannotRegrant` → 409 with `{ error: "consent_revoked_cannot_regrant", hint: "POST /api/admin/consent/clear first to start a fresh cycle" }`
- `ContactNotFound` → 404
- Zod-rejected body → 400 with Zod's issue list
- All success responses include the post-mutation `ContactConsentState` + `status` from `deriveConsentStatus`

No dashboard UI in 1c — the endpoint is the durable admin contract Phase 2 builds against.

## Section 9 — Test fixture coverage

Per 1a/1b-1/1b-2 pattern: all runtime assertions go through `GovernanceVerdict` shape.

| Surface                                                                      | Fixture coverage                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContactConsentStateSchema`, `PdpaJurisdictionSchema`, `ConsentSourceSchema` | Round-trip; null permutations; `*_revocation` source values rejected on grant paths and vice versa                                                                                                                                                                                                                                                                                                                                          |
| `evaluateConsentGate`                                                        | Exhaustive matrix: 4 statuses × 2 message classes = 8 cases per jurisdiction; revoked precedence asserted explicitly (grantedAt set + revokedAt set → revoked); pure-function (no I/O)                                                                                                                                                                                                                                                      |
| `deriveConsentStatus`                                                        | Each status branch; revoked-wins-over-granted; null jurisdiction → not_applicable                                                                                                                                                                                                                                                                                                                                                           |
| `ConsentService.recordDisclosureShown`                                       | First stamp; idempotent same-version; version bump; never touches consent timestamps; throws `ConsentJurisdictionMismatch` on mismatched jurisdiction input                                                                                                                                                                                                                                                                                 |
| `ConsentService.recordGrant`                                                 | Stamps jurisdiction via internal `ensureJurisdictionStamped`; throws `ConsentRevokedCannotRegrant` when revokedAt set; emits `consent_granted` info verdict                                                                                                                                                                                                                                                                                 |
| `ConsentService.recordRevocation`                                            | Idempotent (second call no-op, first timestamp preserved); flips conversation to human_override; annotates open HandoffPackage with `consentRevokedDuringHandoff: true`; emits `consent_revoked` critical verdict                                                                                                                                                                                                                           |
| `ConsentService.clearConsent`                                                | Requires non-empty notes; clears both timestamps; preserves jurisdiction + disclosure fields; rejects `system:` actors; emits `consent_cycle_reset` warning verdict                                                                                                                                                                                                                                                                         |
| `ConsentService.attachToGovernedInteraction`                                 | First call stamps; second call with same jurisdiction is no-op; second call with different jurisdiction throws `ConsentJurisdictionMismatch`                                                                                                                                                                                                                                                                                                |
| Disclosure ↔ consent orthogonality                                           | Dedicated suite: every disclosure method invocation asserted to leave `consentGrantedAt` / `consentRevokedAt` unchanged; every consent method asserted to leave `aiDisclosureShownAt` / `aiDisclosureVersionShown` unchanged                                                                                                                                                                                                                |
| Revocation keyword tables                                                    | Per jurisdiction: 10+ positives, 30+ true-negatives (must include "I'll stop by tomorrow", "remove me from the waitlist for now", "berhenti makan ubat" — preventing the table from firing on benign sentences); unique-`id` invariant at boot; regex `g`-flag stripping                                                                                                                                                                    |
| `scanForRevocationKeywords`                                                  | Pure function; case-insensitive; multi-match returns all (test asserts ordering); not sentence-bounded                                                                                                                                                                                                                                                                                                                                      |
| `PdpaConsentGateHook`                                                        | Mode matrix (off/observe/enforce) × consent status (not_applicable/pending/granted/revoked) × disclosure state (none/current/outdated) per jurisdiction. Asserts: disclosure stamping side-effects, observe-only warning on `disclosure_not_shown` even in enforce, no consent mutation under any disclosure branch, defense-in-depth block on revoked + verdict + status flip + handoff, fail-closed-with-cached-posture on resolver error |
| Gateway revocation scanner                                                   | Match × mode matrix: observe → verdict only, no mutation, no ack, no status flip; enforce → service called, ack sent, status flipped, handoff annotated, submit() skipped; no-match → proceed; pre-contact (sessionContactResolver returns null) → proceed                                                                                                                                                                                  |
| Gateway scanner ordering                                                     | Synthetic inbound containing both "STOP" and pregnancy-trigger language: revocation fires, escalation gate not consulted; reverse case (escalation language only) → revocation skipped, escalation fires                                                                                                                                                                                                                                    |
| Admin endpoint                                                               | Each route: success returns post-mutation state + status; `ConsentRevokedCannotRegrant` → 409 with `hint`; `ConsentJurisdictionMismatch` → 400 with `{ stamped, provided }`; 404 on missing contact; Zod-rejected bodies → 400                                                                                                                                                                                                              |
| Posture cache sharing                                                        | Successful resolution at the gateway warms the cache for the hook (same `deploymentId`); the 1b-1 deterministic-gate cache and 1b-2 classifier cache are untouched by 1c writes; cache `lastKnown` after either write returns the full `{ mode, jurisdiction, clinicType }` triple                                                                                                                                                          |
| Verdict-store integration                                                    | All 1c verdict reasons round-trip through `GovernanceVerdictStore`; `details` JSON column preserves `consentSource`, `event`, `previousVersion`, `newVersion`, `matchId`, `matchedText`, `observe`, `stamped`, `provided`                                                                                                                                                                                                                   |
| Persistence-failure fail-open-of-action                                      | `verdictStore.save` throws after revocation → mutation still applied, status still flipped (emission integrity > persistence completeness, same priority as 1b-1/1b-2)                                                                                                                                                                                                                                                                      |
| Hook-ordering invariant                                                      | Test asserts `PdpaConsentGateHook` is the last hook in the runtime chain before `TracePersistenceHook`; fails if a new hook is registered between them. Trace store records the post-consent-gate `result.response` (which on the rare defense-in-depth block is the handoff template, not original output)                                                                                                                                 |
| Jurisdiction-mismatch handling                                               | Service throw inside hook → critical verdict (`jurisdiction_mismatch`), no block, conversation proceeds; admin endpoint surface → 400                                                                                                                                                                                                                                                                                                       |
| Disclosure substring drift regression                                        | Adding trailing punctuation / whitespace to `DISCLOSURE_COPY.text` breaks detection — change must be a deliberate copy edit + test update                                                                                                                                                                                                                                                                                                   |

Database tests use mocked Prisma (CI has no Postgres, per established convention). API tests use `buildTestServer`.

## Section 10 — Operability

**Per-deployment activation.** Set `agentDeployment.governanceConfig.consentState.mode = "observe"` to start collecting consent verdicts on real traffic. Observe mode persists verdicts but does not mutate `Contact` state, does not send revocation acks, and does not flip status — strictly telemetry. After 2–4 weeks of clean observe data (no false-positive revocation matches, disclosure detection rate stable), promote to `"enforce"`.

**Independent layers.** Each governance phase has its own mode field: `deterministicGate.mode` (1b-1), `claimClassifier.mode` (1b-2), `consentState.mode` (1c). A deployment can run 1b-1 in enforce, 1b-2 in observe, 1c in off — independently flipped. The 1c gate is intentionally additive: a deployment with `consentState.mode = "off"` is byte-identical in behavior to a deployment that pre-dates 1c.

**Rollout pattern (recommended).**

1. `consentState.mode = "observe"` on the pilot tenant.
2. Monitor `auditLevel: "warning"` verdicts for `disclosure_not_shown` and observe-mode `consent_revoked` matches. Tune disclosure copy in skill markdown to match TS constant; tune revocation keyword tables based on false-positive surface.
3. Author the SG/MY disclosure copy in `skills/alex/references/regulatory/{sg,my}-rules.md` so the skill includes it on first outbound.
4. Promote `consentState.mode = "enforce"`. Inbound revocation now mutates state and acknowledges.
5. Phase 1d's proactive sender, when it ships, calls `evaluateConsentGate({ messageClass: "proactive" })` directly — no further bootstrap change required.

**Audit signal.** `auditLevel: "critical"` verdicts (`consent_revoked` enforce, `jurisdiction_mismatch`, defense-in-depth block) are high-priority operator-dashboard signals once Phase 2/3 UI lands. `auditLevel: "warning"` (`disclosure_not_shown`, `disclosure_version_outdated`, `consent_cycle_reset`, observe-mode matches) is the tuning surface.

**Admin endpoint deployment.** New `/api/admin/consent/*` routes deploy with 1c. No dashboard UI in 1c; operators use the endpoint directly (curl or Phase 2 UI). The endpoint is the durable contract Phase 2 builds against.

**No new CI gates.** No new lint/audit script in 1c. Disclosure copy alignment between TS constant and skill markdown is a soft authoring concern caught by the disclosure-drift regression test.

## Out of scope (verbatim restatement)

- Phase 1d — WhatsApp 24h window detection, template registration, proactive sender
- Phase 2 — operator dashboard surface for consent state, revocation history, disclosure timeline
- Phase 3 — outcome tagging, pattern detection on consent-revoked conversations
- Marketing-vs-data-processing two-axis consent (folded into single grant/revoke timestamp pair)
- Re-grant after revocation by user text (admin `clearConsent` resets cycle)
- Hardened (non-substring) disclosure detection — v1 deterministic heuristic only
- Revocation-intent classifier (1b-1 escalation triggers handle nuanced complaints)
- Multi-deployment jurisdiction reconciliation per Contact
- Multi-match revocation analytics (`matches[0]` only)
- Dashboard UI for admin endpoints
- Persistent / cross-instance posture cache (per-process, same trade-off as 1b-1/1b-2)
- Versioned consent copy stored on Contact (audit-trail via verdict `details`)

## Open questions

1. **Post-render text drift.** `PdpaConsentGateHook` operates on `result.response` as it exists at the end of the runtime hook chain. If any future transformation (transport-layer formatting, localization wrappers, markdown→plaintext) runs _after_ the trace persistence hook, disclosure detection and revoked-defense-in-depth verdicts will reflect pre-transformation text. Captured as a hook-ordering invariant + test. Risk surface widens if Switchboard later adds an outbound-rendering pipeline; resolve then.
2. **Multi-match revocation context.** Gateway scanner uses `matches[0]` for verdict `details`. Multi-match conversations (`"STOP unsubscribe"`) discard the second match. Acceptable in 1c; analytics-friendly multi-match capture is deferred.
3. **Disclosure-copy authoring ownership.** Same regulatory-review handoff as 1b-1/1b-2: SG/MY conservative seed copy needs a named reviewer before pilot. PR description names the reviewer + target window.
4. **Cross-deployment Contact governance.** Jurisdiction immutable after first non-null write. If a future product surface lets a Contact interact with two deployments at different jurisdictions (unlikely in v1 — Alex is the only governed deployment per tenant), the stamp doesn't change. Reconcile when the topology actually changes.
5. **Re-grant ergonomics.** v1 requires admin `clearConsent` to start a fresh cycle. If pilots show this is frequent operator friction, a `recordRegrant` method with explicit revocation-cleared transition is an additive follow-up.
