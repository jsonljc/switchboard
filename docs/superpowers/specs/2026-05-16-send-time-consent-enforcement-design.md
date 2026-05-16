# Send-time consent enforcement (cross-channel STOP propagation)

**Date:** 2026-05-16
**Scope:** Wire `ConsentService` revocation state into the outbound send path so revoked contacts cannot be messaged on any channel.
**Status:** Design locked.

## Problem

A second-pass codebase audit (2026-05-16) found that consent revocation is recorded but not enforced at send time:

- `ConsentService.recordRevocation()` (`packages/core/src/consent/consent-service.ts:220`) writes `consentRevokedAt` and emits a `GovernanceVerdict` with `sourceGuard: "consent_gate"` / `reasonCode: "consent_revoked"`.
- `ConsentRevocationGate` (`packages/core/src/channel-gateway/consent-revocation-gate.ts:23`) detects opt-out keywords on **inbound** and triggers the revocation.
- But **no channel adapter or pre-tool-call hook reads `ConsentService` before sending**:
  - `apps/chat/src/adapters/whatsapp.ts:437-471` — `sendMessage` runs without consent check.
  - `apps/chat/src/adapters/whatsapp.ts:81-92` — `canSendWhatsAppTemplate` exists but is never called by upstream send paths.
  - `apps/chat/src/adapters/telegram.ts`, `apps/chat/src/adapters/instagram.ts`, `apps/chat/src/adapters/slack.ts` — no consent check.
  - `packages/core/src/skill-runtime/hooks/governance-hook.ts:12` — `beforeToolCall` checks `effectCategory` and `trustLevel` only, not consent state.

Concrete failure mode: a contact replies "STOP" on WhatsApp. `ConsentService` marks them revoked. The next outbound message — on WhatsApp, Telegram, Instagram, or Slack — still sends. This violates Singapore PDPA §16(1) and Malaysia PDPA §38(1) (revocation must be honored "as soon as practicable") and is a launch-blocking compliance hole for the SG/MY medspa wedge.

## Principle

`ConsentService` is the authoritative source for "may we contact this person now?" Every outbound send path consults it. Revocation is contact-keyed — by design, `consentRevokedAt` lives on `ConsentState`, not per-channel — so a single read enforces cross-channel propagation without per-channel state.

The gate operates on **egress** to complement `ConsentRevocationGate`'s **ingress** detection. Together they form a closed loop: STOP detected → revocation recorded → next send blocked.

A blocked send is not silently dropped. It emits a `GovernanceVerdict` (`sourceGuard: "consent_gate"`, `reasonCode: "consent_revoked"`) and routes to dead-letter (`FailedMessage`) per Doctrine §7.

## Out of scope

- **New revocation keywords.** `packages/core/src/consent/revocation-keywords/{common,sg,my}.ts` already cover SG and MY launch jurisdictions.
- **Emergency-responder bypass.** v1 has no exceptions — STOP means STOP. Adding bypass invites compliance leak vectors; defer to a follow-up spec if a real medical-safety override emerges.
- **Re-grant flow / consent reactivation UI.** Separate spec; for v1 a revoked contact stays revoked until the operator manually clears consent via existing `ConsentService.clearConsent()`.
- **Voice / SMS channels.** Switchboard has no voice or SMS infrastructure today (verified by first-pass audit).
- **Operator-facing revocation roster / dashboard surface.** Existing audit-log surface already shows blocked sends via `GovernanceVerdict` queries.
- **Rebuilding `canSendWhatsAppTemplate`.** Its 24-hour-window + `messagingOptIn` check is correct; the new gate calls it for the WhatsApp template path rather than reimplementing.

## Design

### New module: `ConsentEnforcementGate`

Location: `packages/core/src/consent/consent-enforcement-gate.ts`

```ts
export type SendKind = "conversation" | "template" | "broadcast" | "system_notification";

export interface SendEvaluationInput {
  orgId: string;
  contactId: string;
  channel: "whatsapp" | "telegram" | "instagram" | "slack";
  kind: SendKind;
  // For WhatsApp templates only — used to evaluate the 24h window.
  templateCategory?: "UTILITY" | "MARKETING" | "AUTHENTICATION";
}

export type SendEvaluation =
  | { allowed: true }
  | { allowed: false; reasonCode: ConsentReasonCode; verdict: GovernanceVerdict };

export interface ConsentEnforcementGate {
  evaluateSend(input: SendEvaluationInput): Promise<SendEvaluation>;
}
```

**Internal logic** (in priority order — first match wins):

1. **`consentRevokedAt` present** → deny with `reasonCode: "consent_revoked"`. Cross-channel: applies regardless of `input.channel`.
2. **WhatsApp template send** (`channel === "whatsapp" && kind === "template"`) → defer to existing `canSendWhatsAppTemplate(contact, templateCategory, now)` logic. Deny with `reasonCode: "consent_pending"` if outside 24h window without explicit opt-in, or `reasonCode: "consent_missing"` if no `messagingOptInAt`.
3. **Otherwise** → allow.

**Verdict emission:** every deny writes a `GovernanceVerdict` to `GovernanceVerdictStore` with `sourceGuard: "consent_gate"`, the matching `reasonCode`, and a structured `details` payload `{ contactId, channel, kind, deniedAt }`. Verdicts are read by the existing `/api/dashboard/audit` surface and operator inboxes.

### Integration point: channel adapters

Each adapter's `sendMessage` (and `sendTemplate`/`sendFlow` where applicable) calls the gate before any network I/O:

```ts
// apps/chat/src/adapters/whatsapp.ts (pattern; same for the other three)
async sendMessage(input: WhatsAppSendInput): Promise<SendResult> {
  const evaluation = await this.consentGate.evaluateSend({
    orgId: input.orgId,
    contactId: input.contactId,
    channel: "whatsapp",
    kind: input.kind ?? "conversation",
    templateCategory: input.kind === "template" ? input.templateCategory : undefined,
  });
  if (!evaluation.allowed) {
    throw new ConsentRevokedError(evaluation.reasonCode, evaluation.verdict);
  }
  // ...existing send logic...
}
```

`ConsentRevokedError` is a typed error (`packages/core/src/consent/consent-revoked-error.ts`) with the verdict attached. The chat runtime's existing send-error handler (which already routes failed sends to `FailedMessage` per Doctrine §7) catches this error and persists the dead-letter row with `reasonCode` populated; no new dead-letter pathway is required.

### Integration point: skill-runtime (defense in depth)

A new `ConsentEnforcementHook` (`packages/core/src/skill-runtime/hooks/consent-enforcement-hook.ts`) registers as a `beforeToolCall` hook for tools whose `effectCategory === "send-message"`. It calls the same `ConsentEnforcementGate.evaluateSend` and short-circuits the tool call with a denial outcome that flows through the existing `GovernanceHook` denial path.

This is redundant with the adapter check but cheap, and it ensures that any future skill that bypasses the chat runtime (e.g., a Riley broadcast skill) still gets gated.

### Wiring

`ConsentEnforcementGate` is constructed once at app startup, injected into:

- `apps/chat/src/bootstrap/adapters.ts` (or wherever adapters are constructed)
- `packages/core/src/skill-runtime/skill-executor.ts` hook registration

The gate's only dependencies are `ConsentService` and `GovernanceVerdictStore`, both already constructed for current consent and governance flows.

## Schema changes

**None.** The design uses existing fields:

- `ConsentState.consentRevokedAt` (per HIPAA-audit verification)
- `Contact.messagingOptIn`, `Contact.messagingOptInAt`, `Contact.messagingOptInSource` (`schema.prisma:837-840`)
- `GovernanceVerdict` with existing `sourceGuard`/`reasonCode` enums

## Implementation order (suggested PR cuts)

1. **PR 1 — gate module + WhatsApp wiring** (~80 LOC). Build `ConsentEnforcementGate`, `ConsentRevokedError`. Wire into `WhatsAppAdapter.sendMessage` + `sendTemplate` + `sendFlow`. Tests: gate unit tests + WhatsApp adapter integration tests.
2. **PR 2 — Telegram + Instagram + Slack wiring** (~40 LOC). Repeat the adapter pattern for the remaining three channels. Tests: per-adapter integration test.
3. **PR 3 — `ConsentEnforcementHook` + cross-channel regression test** (~40 LOC). Add the skill-runtime hook for defense in depth. Add a hygiene test that revoking on WhatsApp blocks subsequent sends on Telegram, Instagram, and Slack within the same `orgId + contactId`.

Total scope: ~160 LOC across roughly 8 files. Three small PRs. Estimated 1-2 days end-to-end.

## Testing

**Unit (gate):**

- Allowed when consent active.
- Denied with `consent_revoked` when `consentRevokedAt` set.
- Denied with `consent_pending` for WhatsApp template outside 24h window.
- Denied with `consent_missing` for WhatsApp template without opt-in.
- Verdict written on every deny.

**Per-adapter integration:**

- Each adapter's `sendMessage` calls the gate before network I/O (mock the adapter's HTTP client).
- Each adapter throws `ConsentRevokedError` and emits no network call when revoked.

**Cross-channel regression** (the load-bearing test for the spec):

- Revoke contact via `ConsentService.recordRevocation()` (jurisdiction = SG, source = `inbound_keyword_revocation`).
- Attempt sends on WhatsApp, Telegram, Instagram, and Slack — assert all four are blocked, all four emit verdicts.
- Re-grant via `ConsentService.recordGrant()` and assert sends resume.

**Hygiene test:**

- A test that introspects each adapter file and asserts `evaluateSend` is called in `sendMessage` (grep-style guard against future bypass). Place under `apps/chat/src/__tests__/adapter-consent-enforcement.hygiene.test.ts`.

## Risks

- **System notifications might break.** Some current outbound traffic (e.g., escalation reply to operator) could be classified `system_notification` and may need to bypass consent. Mitigation: `kind: "system_notification"` is allowlisted in v1 only for `escalation_reply` and `operator_notification`; everything else gates. Audit existing send call sites and tag explicitly during implementation; default-gate any untagged call.
- **Stale `ConsentService` reads.** If `ConsentService` reads from a replica with lag, a contact who STOPped 100ms ago might still get one more send. Mitigation: `ConsentService.isRevoked` reads from the primary write path (existing pattern); no replica read introduced.
- **Adapter bypass.** A future code path that calls Meta Graph API or Twilio directly without going through an adapter would bypass the gate. Mitigation: this is the design boundary; the hygiene test catches it for the four current adapters; future adapter additions inherit the test by following the same pattern. PR 3's `ConsentEnforcementHook` provides defense in depth at the skill-runtime layer.
- **Performance.** Each send adds a single Postgres SELECT against `ConsentState` (already-indexed by `(orgId, contactId)`). At launch volume (<10 sends/sec total) this is negligible. At 100+ sends/sec, add a per-process LRU cache keyed on `(orgId, contactId)` with 5-second TTL — not in v1.

## Doctrine alignment

- **§1 PlatformIngress as canonical entry** — this gate is on **egress**, complementary not conflicting.
- **§7 Dead-letter for every async path** — blocked sends route to `FailedMessage` via the existing chat-runtime send-error handler.
- **§8 Human override is first-class** — operators can clear revocation via `ConsentService.clearConsent()`; that path stays unchanged.
- **§9 Tools are strict, auditable, idempotent** — `evaluateSend` is idempotent and emits an auditable verdict on every decision.
- **§10 Channel as ingress** — the doctrine says channels are ingress surfaces, not alternative execution architectures. This spec adds an egress gate to the same channel boundary; the channel still does no business logic — it just consults the authoritative consent service before transmitting.

## Success criteria

- A contact who STOPs on WhatsApp cannot receive any message on WhatsApp, Telegram, Instagram, or Slack within the same `orgId + contactId` until consent is re-granted.
- Every blocked send is auditable via `GovernanceVerdict` query within the org.
- The cross-channel regression test passes in CI.
- No regression in existing send-success rate for non-revoked contacts.
