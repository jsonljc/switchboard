# Block chat approval payloads from conversational ingress

**Status:** spec
**Date:** 2026-04-29
**Branch slug:** `fix/launch-chat-binding-hash-verification`
**Audit reference:** `.audit/08-launch-blocker-sequence.md` Risk #4 ("Chat approval binding hash not verified (asymmetry)")
**Effort:** S (focused gateway fix; lifecycle mutation deferred to follow-up)

## Summary

Chat adapters today receive button-press JSON of the shape
`{"action":"approve","approvalId":"...","bindingHash":"..."}` (`action`
must be either `"approve"` or `"reject"`) as `message.text` and the
gateway forwards that text into
`PlatformIngress.submit()` with no validation. The LLM interpreter is the
de-facto arbiter of whether the approval succeeds. The API path verifies
binding hashes via `PlatformLifecycle.respondToApproval` →
`validateBindingHash` (timingSafeEqual at
`packages/core/src/platform/platform-lifecycle.ts:436`); chat does not.

This slice intercepts approval-shaped payloads at the gateway and treats
them as terminal control messages. Missing, org-mismatched, stale, or
binding-hash-valid approvals all reply once and return. Approval payloads
never reach `PlatformIngress.submit()`, never reach the LLM, and are not
persisted as chat turns. Lifecycle mutation from chat is intentionally
deferred to a follow-up slice that introduces responder-principal
resolution.

The slice also fixes notifier payload parity so both Approve and Reject
button clicks carry `bindingHash` and are intercepted by the same strict
gateway parser.

This PR makes chat approval payload handling safe, not complete.
Completion requires the follow-up identity-binding slice before chat
can mutate approval lifecycle state.

## Audit findings

- `ChannelGateway.handleIncoming()`
  (`packages/core/src/channel-gateway/channel-gateway.ts:11-149`) ships
  the approval JSON straight into `PlatformIngress.submit()` as
  `parameters.message`. No detection, no validation.
- `ChannelGatewayConfig`
  (`packages/core/src/channel-gateway/types.ts`) has no
  `approvalStore`/lifecycle reference today.
- `validateBindingHash` already exists in two forms:
  - structured-data version at
    `packages/core/src/approval/binding.ts:29` (recomputes hash from
    canonical inputs).
  - private timingSafeEqual on stored vs supplied hash at
    `packages/core/src/platform/platform-lifecycle.ts:436`.
- `ApprovalStore` interface at
  `packages/core/src/storage/interfaces.ts:48` already exposes
  `getById(id)`. `PrismaApprovalStore` (`@switchboard/db`) and
  `InMemoryApprovalStore` are both implemented.
- Notifiers (`whatsapp-notifier.ts`, `telegram-notifier.ts`,
  `slack-notifier.ts`) emit the approval JSON as button payload.
  **Bug:** the Approve button payload includes `bindingHash`; the
  Reject button payload does **not** (`whatsapp-notifier.ts:64`,
  matching shape in telegram and slack notifiers). Under a strict
  parser this would cause every Reject click to fall through to
  normal chat. Fixed in this slice.
- Chat tests confirm adapters parse the JSON into `msg.text`
  (`apps/chat/src/__tests__/whatsapp.test.ts:160`,
  `apps/chat/src/__tests__/instagram.test.ts:106`) but no production
  code branches on `action="approve"|"reject"`.

## Decision

A1 detection placement (gateway-internal, inside `handleIncoming` after
deployment resolve and pause handling) + (c) terminal-on-all-payloads
behavior. No adapter changes, no `IncomingChannelMessage` shape change,
no responder/lifecycle/identity/ledger wiring, no API route changes.
Notifier emitters are updated only to make existing Reject button
payloads include the same `bindingHash` already present on Approve
payloads.

### Rejected alternatives

- **A2 — adapter-signaled detection.** Cleaner architectural seam (button
  payloads are structurally distinct from typed text) but inflates surface
  area: every adapter, every adapter test, plus an
  `IncomingChannelMessage` shape change. Right move once channel-action
  handling is generalized; not this slice.
- **B / C — deterministic lifecycle mutation on hash match.** Requires a
  trusted `respondedBy` principal. Chat has no verified contact →
  principal mapping today; no mutating bypass path
  (`skipResponderAuth: true`) is acceptable per doctrine. Pulled into the
  follow-up slice.

## Architecture

```
adapter (whatsapp/telegram/slack/instagram)
    ↓ (no changes)
ChannelGateway.handleIncoming(message)
    ↓
[1] resolve deployment + pause check          ← unchanged
[2] parseApprovalResponsePayload(message.text)
        ├─ null  → continue to [3] normal chat flow (unchanged)
        └─ payload → handleApprovalResponse(...) → return
              └─ approvalStore.getById(approvalId)
                    ├─ throws        → reply APPROVAL_LOOKUP_ERROR_MSG + return
                    ├─ not found     → reply NOT_FOUND_MSG + return
                    ├─ org mismatch  → reply NOT_FOUND_MSG + return  (don't leak existence)
                    ├─ hash mismatch → reply STALE_MSG + return
                    └─ hash match    → reply DASHBOARD_HANDOFF_MSG + return  (temporary handoff)
[3] persist + submit + reply                   ← unchanged
```

### Core invariant

Once `parseApprovalResponsePayload` returns a non-null payload, the
branch is terminal. Every outcome either replies and returns, or throws
into existing gateway error handling. It never persists the payload as
chat input, never calls `onTyping`, never calls `PlatformIngress.submit`,
and never invokes the LLM.

## Components & file map

### New files

- `packages/core/src/channel-gateway/approval-response-payload.ts`
  - Strict-shape parser. Public exports:
    ```ts
    export type ParsedApprovalResponsePayload = {
      action: "approve" | "reject";
      approvalId: string;
      bindingHash: string;
    };
    export function parseApprovalResponsePayload(
      text: string | null | undefined,
    ): ParsedApprovalResponsePayload | null;
    ```
  - Rules:
    - `JSON.parse` only.
    - Parsed value must be a plain object (not array, not null, not
      number/string).
    - `action` must be exactly `"approve"` or `"reject"`.
    - `approvalId` must be a non-empty string.
    - `bindingHash` must be a non-empty string.
    - Extra fields → return `null` (strict shape).
    - Any failure path returns `null` (no throws escape the helper).
- `packages/core/src/channel-gateway/handle-approval-response.ts`
  - Public export:
    ```ts
    export async function handleApprovalResponse(params: {
      payload: ParsedApprovalResponsePayload;
      organizationId: string;
      approvalStore: ApprovalStore;
      replySink: ReplySink;
    }): Promise<void>;
    ```
  - Behavior matches the architecture diagram exactly. Uses
    `timingSafeEqual` over equal-length `Buffer.from(...)` of stored
    vs supplied hash, with explicit length-pre-check (timingSafeEqual
    throws on length mismatch — guarded so it returns
    `STALE_MSG` instead of throwing).
  - Constants exported from this file:
    ```ts
    export const NOT_FOUND_MSG =
      "I couldn't find this approval. It may have expired, been completed, or been replaced. Open the latest approval and try again.";
    export const STALE_MSG =
      "This approval link is no longer valid. It may have expired or been replaced by a newer approval. Open the latest approval and try again.";
    export const DASHBOARD_HANDOFF_MSG =
      "Approval buttons in chat are being upgraded. Please approve or reject this from the dashboard for now.";
    export const APPROVAL_LOOKUP_ERROR_MSG =
      "I couldn't verify this approval right now. Please open the dashboard and try again.";
    ```

### Modified files

- `packages/core/src/channel-gateway/channel-gateway.ts`
  - In `handleIncoming`, after step 3b ("human override" check) and
    before step 3c (contact identity resolution), call
    `parseApprovalResponsePayload(message.text)`.
  - If non-null, call `handleApprovalResponse({ payload,
organizationId: resolved.organizationId, approvalStore:
this.config.approvalStore, replySink })` and `return`. The branch is
    terminal — no `onTyping`, no `conversationStore.addMessage`, no
    `platformIngress.submit`.
- `packages/core/src/channel-gateway/types.ts`
  - Add **required** field to `ChannelGatewayConfig`:
    ```ts
    /** Read-only approval lookup for binding-hash verification of
        approval-shaped channel payloads. Required so verification
        cannot be silently skipped by misconfiguration. */
    approvalStore: ApprovalStore;
    ```
  - Re-export `ApprovalStore` from `../storage/interfaces.js` if it
    isn't already in the channel-gateway public surface.
- `apps/chat/src/gateway/gateway-bridge.ts`
  - Wire `PrismaApprovalStore` into the `ChannelGateway` constructor:
    ```ts
    import { PrismaApprovalStore } from "@switchboard/db";
    // …
    return new ChannelGateway({
      // existing fields
      approvalStore: new PrismaApprovalStore(prisma),
    });
    ```
- `packages/core/src/index.ts` (or wherever `channel-gateway` is
  re-exported) — re-export the new parser/handler module entry points
  if other apps need them. Typically not required; verify during
  implementation.
- `packages/core/src/notifications/whatsapp-notifier.ts`
  - Add `bindingHash: n.bindingHash` to the Reject button payload
    (currently at line 64 in the `{ action: "reject", approvalId }`
    JSON). Approve button payload already includes it.
- `packages/core/src/notifications/telegram-notifier.ts`
  - Add `bindingHash: n.bindingHash` to the Reject button payload in
    `buildButtons()`.
- `packages/core/src/notifications/slack-notifier.ts`
  - Add `bindingHash: n.bindingHash` to the Reject button `value` JSON.

### Explicit non-touches

- **No adapter changes.** WhatsApp, Telegram, Slack, Instagram adapters
  are untouched.
- **No `IncomingChannelMessage` shape change.** No new field, no kind
  discriminator.
- **No `approvalResponder` dependency.**
- **No `ApprovalLifecycleService` wiring from chat.**
- **No `PlatformLifecycle.respondToApproval` wiring from chat.**
- **No `identityStore` / principal authorization.**
- **No ledger / audit events for malformed or stale chat approvals.**
- **No API route behavior change.**
- **Notifier changes are limited to binding-hash parity for Reject
  payloads.** Existing Reject button payloads now include
  `bindingHash`, matching Approve. No other notifier behavior change.

## Data flow & error handling

### Approval branch ordering

After `[1]` deployment resolve + pause handling:

1. `parseApprovalResponsePayload(message.text)`
2. `null` → fall through to existing normal chat path (unchanged).
3. payload → terminal branch:
   - no `onTyping`
   - no inbound persistence
   - no `PlatformIngress.submit`
   - call `handleApprovalResponse(...)`
   - reply once
   - return

### Handler outcomes

| Case                  | Reply                                       | Submit? | Persist? | onTyping? |
| --------------------- | ------------------------------------------- | ------- | -------- | --------- |
| store.getById throws  | `APPROVAL_LOOKUP_ERROR_MSG`                 | no      | no       | no        |
| approval not found    | `NOT_FOUND_MSG`                             | no      | no       | no        |
| org mismatch          | `NOT_FOUND_MSG` (don't leak existence)      | no      | no       | no        |
| binding-hash mismatch | `STALE_MSG`                                 | no      | no       | no        |
| binding-hash match    | `DASHBOARD_HANDOFF_MSG` (temporary handoff) | no      | no       | no        |

### Store-error fail-closed

If `approvalStore.getById` throws, the gateway does **not** fall through
to normal chat. The approval branch is terminal: reply
`APPROVAL_LOOKUP_ERROR_MSG` and return. Reason: once the message parsed
as an approval payload, treating it as conversational input would let a
store outage degrade into LLM-arbitrated approval handling.

### Reply-error behavior

If `replySink.send` throws inside the approval branch, the error
propagates through existing top-level gateway error handling/logging.
Normal chat flow is **not** resumed. The terminal-branch invariant
holds even on reply failure.

### Length-mismatch guard

`timingSafeEqual` throws on different-length buffers. The handler
length-pre-checks: if `storedHash.length !== suppliedHash.length`,
treat as mismatch (`STALE_MSG`), do not call `timingSafeEqual`.

## Testing strategy

### Section 4 acceptance criteria

Section 4 passes when:

1. Parser strictness is covered independently.
2. Handler reply outcomes are covered independently.
3. Gateway proves approval payloads are terminal.
4. Existing normal chat tests still pass with `approvalStore` injected.
5. No adapter tests require changes.
6. No lifecycle mutation is introduced.
7. Approve and Reject notifier payloads both include `bindingHash`.

### 1. Parser unit tests

`packages/core/src/channel-gateway/__tests__/approval-response-payload.test.ts`

- valid `"approve"` payload → returns payload
- valid `"reject"` payload → returns payload
- invalid JSON → null
- plain text → null
- empty string → null
- `null` / `undefined` → null
- JSON array → null
- JSON string → null
- JSON number → null
- JSON `null` → null
- missing `action` → null
- unknown action `"deny"` → null
- unknown action `"patch"` → null
- unknown action `"approved"` → null
- missing `approvalId` → null
- empty `approvalId` → null
- non-string `approvalId` → null
- missing `bindingHash` → null
- empty `bindingHash` → null
- non-string `bindingHash` → null
- payload with extra field → null (strict shape)

### 2. Handler unit tests

`packages/core/src/channel-gateway/__tests__/handle-approval-response.test.ts`

- approval not found → `NOT_FOUND_MSG` once, no throw
- approval org mismatch → `NOT_FOUND_MSG` once
- binding-hash mismatch → `STALE_MSG` once
- different-length supplied/stored hashes → `STALE_MSG`, no throw
  (guards `timingSafeEqual` length precondition)
- binding-hash match → `DASHBOARD_HANDOFF_MSG` once
- `approvalStore.getById` throws → `APPROVAL_LOOKUP_ERROR_MSG` once
- assert `approvalStore.getById` called with `payload.approvalId`
- assert `replySink.send` called exactly once

### 3. Gateway behavior tests

`packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`

Normal-flow regression:

- parser returns null → existing normal chat path persists, submits,
  replies as today.

Approval branch (for each of: not-found, org-mismatch, hash-mismatch,
hash-match, store-throws):

- correct reply text sent
- `conversationStore.addMessage` not called for the inbound payload
- `replySink.onTyping?` not called
- `platformIngress.submit` not called

Reply-failure case:

- `replySink.send` throws inside approval branch → error propagates
  through existing top-level behavior; no fall-through to normal chat;
  `platformIngress.submit` still not called.

Pause-behavior preservation:

- paused deployment receives existing pause response before approval
  parsing runs (verifies ordering: deployment resolve + pause check
  first, approval parsing second).

### 4. Notifier payload parity tests

Affected emitters:

- WhatsApp — extend existing
  `apps/chat/src/__tests__/whatsapp-notifier.test.ts`
- Telegram — new file
  `packages/core/src/notifications/__tests__/telegram-notifier.test.ts`
- Slack — new file
  `packages/core/src/notifications/__tests__/slack-notifier.test.ts`

Cases (per emitter):

- Approve button payload includes `action`, `approvalId`,
  `bindingHash`.
- Reject button payload includes `action`, `approvalId`,
  `bindingHash`.
- Reject button payload's `bindingHash` matches the
  notification's `bindingHash` value (parity with Approve).

### Test factory updates

`approvalStore` becomes required on `ChannelGatewayConfig`. Update
gateway test builders/factories to inject:

```ts
const mockApprovalStore = {
  getById: vi.fn().mockResolvedValue(null),
};
```

Required, not optional, in tests — reinforces the production invariant.

### Out of scope

- No adapter payload extraction tests.
- Notifier tests are limited to existing approval button payload
  shape (parity assertions on Approve and Reject); no broader
  notifier-behavior tests added.
- No `ApprovalLifecycleService` tests.
- No `PlatformLifecycle.respondToApproval` tests.
- No `identityStore` / principal authorization tests.
- No ledger tests.
- No API approval route tests unless shared types break compilation.

## Rollout, doctrine alignment, and follow-up linkage

### Rollout posture

This is a trust-boundary hardening slice, not a feature-completion
slice.

Merged behavior:

- Chat approval-shaped payloads are intercepted before normal chat
  runtime.
- Invalid, stale, org-mismatched, or currently-valid approval payloads
  never enter `PlatformIngress.submit()`.
- Valid approval payloads receive a temporary dashboard handoff
  message.
- Approval execution from chat remains disabled until responder
  identity binding is implemented.

### Doctrine alignment

This slice satisfies:

- No lifecycle-control payload is interpreted by the LLM.
- No approval-shaped payload enters normal conversational ingress.
- Stale or spoofed approval payloads fail closed.
- Org mismatch does not leak approval existence.
- Gateway behavior is deterministic once the payload parses.
- Misconfigured approval verification is prevented by requiring
  `approvalStore` in `ChannelGatewayConfig`.

This slice intentionally defers:

- Deterministic approve/reject mutation from chat.
- Contact → principal responder identity resolution.
- Shared API/chat approval response helper.
- `ApprovalLifecycleService` / `PlatformLifecycle` wiring from chat.
- Ledger/audit events for stale or spoofed chat approval attempts.
- Adapter-signaled structured channel actions.

### Follow-up linkage

Add a follow-up entry to
`.audit/08-launch-blocker-sequence.md` immediately after Risk #4 in the
approval/lifecycle blocker cluster:

```
Follow-up: Chat Approval Response Identity Binding

Goal:
Enable deterministic approve/reject execution from chat without
bypassing responder authorization.

Required before enabling chat approval execution:
- Resolve inbound chat sender to Contact.
- Map Contact to authorized responder principal.
- Pass respondedBy into the same responder authorization path used
  by API approvals.
- Share approval response execution helper between API and chat.
- Preserve terminal approval-payload branch: no LLM, no
  PlatformIngress.submit, no normal chat persistence.
- Add lifecycle mutation tests for approve/reject from chat.
- Do not introduce skipResponderAuth or channel-possession-only
  authorization.
```

### PR title

`Block chat approval payloads from conversational ingress`

### Commit message

```
fix(chat): block approval payloads from conversational ingress

Intercept approval-shaped payloads in ChannelGateway before normal
message persistence and PlatformIngress submission.

Valid, stale, missing, or org-mismatched approval payloads are
handled as terminal gateway control messages and never reach the
LLM. Valid approval payloads receive a temporary dashboard handoff
until chat responder identity binding is implemented.

This slice does not execute approvals from chat.
```

### Merged in this slice

- Gateway-local approval payload parser.
- Strict-shape approval payload validation.
- Required read-only `approvalStore` dependency on
  `ChannelGatewayConfig`.
- Gateway terminal branch for approval-shaped payloads.
- Not-found, org-mismatch, stale, lookup-error, and dashboard-handoff
  replies.
- Tests proving no submit, no LLM path, no `onTyping`, no inbound
  persistence for approval payloads.
- Gateway-bridge wiring for `PrismaApprovalStore`.
- Reject button payloads in WhatsApp, Telegram, and Slack notifiers
  now include `bindingHash`, matching Approve payloads.
- Audit note / launch-blocker update linking the follow-up.

### Left for follow-up

- Real approve/reject execution from chat.
- `approvalResponder` dependency.
- `ApprovalLifecycleService` / `PlatformLifecycle` mutation wiring.
- `respondedBy` principal resolution.
- Contact → principal mapping.
- Shared API/chat approval execution helper.
- Ledger events for malformed/stale/tamper attempts.
- Adapter-level structured action payloads.
- `IncomingChannelMessage.approvalPayload` or `channelAction` shape.

---

This PR makes chat approval payload handling safe, not complete.
Completion requires the follow-up identity-binding slice before chat
can mutate approval lifecycle state.
