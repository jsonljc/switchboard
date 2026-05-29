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

---

## PR 4 — Egress bypass discovery (2026-05-16)

### Search summary

Eight grep patterns were run against `packages/` and `apps/` (excluding `dist/`, `__tests__/`, `.test.ts`):

1. All `ChannelAdapter` interface send methods (`sendTextReply`, `sendApprovalCard`, etc.)
2. `replySink.send` / `ReplySink` usage
3. Direct adapter class references outside `ChannelGateway`
4. `effectCategory.*send-message` / skill-runtime send-message tools
5. `sendTemplate` / `canSendWhatsAppTemplate` / `MessageTemplate` (broadcast paths)
6. Riley / outcome-attribution emissions (`outcome-dispatcher`, `RecommendationOutcome`, etc.)
7. Operator-direct mutations (`store_recorded_operator_mutation`, `operator.send`)
8. Direct HTTP POSTs to Meta Graph API, Telegram Bot API, Twilio, Slack API

### Classification

**Category 1 — Gateway-mediated** (safe, already gated):

- `apps/chat/src/routes/managed-webhook.ts:158-171` — `replySink.send` is wired as `gatewayEntry.adapter.sendTextReply(threadId, text)` but called only inside `gatewayEntry.gateway.handleIncoming(...)`, which routes through `ChannelGateway.dispatchResponse` where `runConsentEnforcementGate` now runs (PR 2).
- `apps/chat/src/main.ts:318-325` — Same pattern for the single-tenant Telegram path: `replySink.send` passed into `singleTenantGateway.handleIncoming`, routed through `ChannelGateway`.
- `apps/chat/src/endpoints/widget-messages.ts:41` — Widget messages routed through `ChannelGateway`.
- `packages/core/src/channel-gateway/handle-approval-response.ts` — All `replySink.send` calls here are responses to operator approval/rejection button presses, routed through the same `ChannelGateway.handleIncoming` path.
- `packages/core/src/channel-gateway/pre-input-gate.ts` — `replySink.send` for handoff messages; same path.
- `packages/core/src/channel-gateway/consent-revocation-gate.ts` — `replySink.send` for STOP acknowledgement; same path.

**Category 2 — Adapter-internal** (implementation detail, not an external bypass):

- `apps/chat/src/adapters/whatsapp.ts:207` — `sendTemplateMessage` is an adapter method that calls `this.sendMessage(...)`. It has zero external call sites (grep confirms: only its own definition). Not reachable outside the adapter without going through the adapter's public interface.
- All adapter `sendTextReply`/`sendApprovalCard`/`sendResultCard`/`sendMedia`/`sendFlowMessage` implementations — these are the adapter interface implementations. They are called by `ChannelGateway.dispatchResponse` via the `ReplySink` abstraction (Category 1 paths above).
- `apps/chat/src/escalation/routing.ts:13` — `routeEscalation` calls `adapter.sendTextReply` but has no external callers. It is dead code (grep found no import sites). Not a current bypass.

**Category 3 — Skill-runtime send-message tools** (0 hits):

No tools with `effectCategory === "send-message"` were found. The skill-runtime hook defined in the spec design is therefore a precautionary addition for future skills, not a fix for any currently existing bypass. The spec's PR 3 implementation hook (`ConsentEnforcementHook`) was already shipped as described in PRs 1-3, but there is nothing currently to gate via that path.

**Category 4 — Broadcast/operator-direct/non-gateway senders** (3 confirmed bypass paths):

1. **`ProactiveSender` — operator-sends-to-contact path** (`packages/core/src/notifications/proactive-sender.ts:82-160`):
   - Called by `apps/api/src/routes/conversations.ts:374` (`POST /api/conversations/:threadId/send`) to deliver an operator-authored message to the contact (`destinationPrincipalId`) during `human_override` mode. This is a genuine contact-facing outbound send.
   - Called by `apps/api/src/routes/escalations.ts:245` to deliver an operator escalation reply to the contact.
   - `ProactiveSender.sendProactive()` makes direct HTTP calls to `api.telegram.org/sendMessage`, `slack.com/api/chat.postMessage`, and `graph.facebook.com/.../messages` with zero consent gate. If a contact has revoked consent, an operator can still message them via the dashboard "Send" action or escalation reply.
   - **Why it bypasses:** The API route calls `app.agentNotifier.sendProactive()` directly — there is no `ChannelGateway` in this path. The `ProactiveSender` class has no knowledge of `ConsentService`.

2. **`buildMetaLeadGreetingWorkflow`** (`apps/api/src/services/workflows/meta-lead-greeting-workflow.ts:22-43`):
   - This workflow fires a WhatsApp template message (type `"template"`) directly to a lead's phone number via `fetch("https://graph.facebook.com/v21.0/...")`. It is registered as `meta.lead.greeting.send` in `apps/api/src/bootstrap/contained-workflows.ts:123` and runs as a contained workflow (triggered by lead intake).
   - The input is `{ phone, firstName, templateName }` — a raw phone number from the lead event, with no `contactId` lookup, no `ConsentService` call, and no `ChannelGateway` routing.
   - **Why it bypasses:** It directly constructs a Graph API HTTP request. The spec's `ConsentEnforcementGate.evaluateSend` is never consulted. A lead who replied STOP to a prior campaign message could be greeted again at intake.

3. **`whatsapp-send-test.ts` send-test route** (`apps/api/src/routes/whatsapp-send-test.ts:88-240`):
   - `POST /send-test` sends a WhatsApp template to a phone number on the channel's `testRecipients` allowlist. Calls `graphPost(...)` which makes a direct Graph API fetch. No consent check.
   - Mitigating factor: recipients are on an explicit operator-managed allowlist; this is a developer/QA tool, not a production send path. The risk is lower than the two paths above.
   - **Why it bypasses:** Calls `graphPost()` directly; no `ChannelGateway` or `ConsentEnforcementGate` in the path.

**Category 5 — Tests/fixtures** (not counted; excluded from search by `grep -v __tests__ | grep -v "\.test\."`).

**Not-a-bypass — Approval notifiers:**

`WhatsAppApprovalNotifier`, `TelegramApprovalNotifier`, `SlackApprovalNotifier` (`packages/core/src/notifications/`) send messages to **operator approvers** — business staff who own the bot, not consumer contacts. Consumer PDPA consent does not apply to operator-facing approval notifications. These are excluded from consent scope.

### Verdict

**B — Bypass paths found.** Two active production-send bypass paths exist:

1. `ProactiveSender` used in `conversations.ts` and `escalations.ts` to deliver messages to contacts, bypassing `ChannelGateway`.
2. `buildMetaLeadGreetingWorkflow` sending WhatsApp templates directly to lead phone numbers with no consent check.

`ConsentEnforcementHook` for skill-runtime is NOT required (no Category 3 hits). The required fix is gating the two Category 4 paths at source — the hook would not reach them since they are not skill-runtime tool calls.

### Implementation direction for bypasses (tracked, not in this PR)

**Bypass 1 — `ProactiveSender` / conversations + escalations routes:**

The correct fix is to call `ConsentEnforcementGate.evaluateSend(...)` inside `ProactiveSender.sendProactive()` (or in the two route handlers before calling `sendProactive`). `ProactiveSender` currently receives only a `chatId` (the contact's principal ID on the channel) and a `channelType` string — it does not carry `orgId` or `contactId`. The gate requires `orgId + contactId`. The route handlers do have `orgId` (from auth) and can resolve `contactId` from the conversation record. The cleanest fix is to gate at the route handler level before calling `sendProactive`, or to thread `orgId` and `contactId` through into a gated wrapper.

**Bypass 2 — `buildMetaLeadGreetingWorkflow`:**

The workflow fires at lead intake time — the contact may not yet have a `consentRevokedAt` because they are a new lead. The consent gap is narrower here, but CTWA opt-in semantics still require checking `messagingOptIn` status before sending a template. The fix is to pass a `consentStore` into the workflow's dependencies and call `ConsentEnforcementGate.evaluateSend` before the `fetch(...)`.

### Tracked follow-up

Issue to file: **"PR 4 follow-up: gate ProactiveSender and MetaLeadGreetingWorkflow at consent enforcement"** — linking this discovery commit. The two bypasses above require:

- Route-level consent gate in `conversations.ts:POST /:threadId/send` before `sendProactive`
- Route-level consent gate in `escalations.ts` before `sendProactive`
- Dependency injection of `ConsentEnforcementGate` into `buildMetaLeadGreetingWorkflow`
- `whatsapp-send-test.ts` send-test: low priority (operator allowlist mitigates); gate opportunistically when touching this file.

This PR (PR 4) delivers the discovery output. The hook (`ConsentEnforcementHook`) is **not shipped** in PR 4 — there are no skill-runtime bypass paths to gate, and the two actual bypasses require source-level fixes, not a hook.
