# Slack approval notifications: the outbound half of the operator loop

Date: 2026-06-05
Status: approved (autonomous slice; closes the outbound gap named in
2026-06-05-chat-approval-bridge-design.md section 6)
Proving case: a real parked approval (the Riley to Mira handoff) produces a Slack
message with Approve/Reject buttons in the operator conversation; the Approve tap rides
the shipped respond bridge, executes the frozen action through the REAL engine, and
replies honestly in the same conversation.

Governing invariant (inherited from the bridge spec): **a human approves exactly one
frozen action, and the system either executes that exact action or exposes the failed
execution for recovery.** New corollary for this slice: **a notification is best-effort
delivery of an invitation to act, never part of the approval's authority chain.** A lost
notification loses nothing: the dashboard Inbox remains the canonical operator surface,
and the lifecycle holds the only authoritative state.

## 1. Problem

All facts verified against origin/main `1a5172e6` (2026-06-05).

The respond side is DONE and live on deploy (#900/#902/#909/#910): any Slack
block_actions tap whose value is the JSON payload `{action, approvalId, bindingHash}`
reaches `handleApprovalResponse` in transport mode, rides
`HttpApprovalRespondTransport` to `POST /api/internal/chat-approvals/respond`, gets its
principal re-derived server-side from `OperatorChannelBinding`, and runs the unified
engine, with honest replies and a six-leg e2e proof
(`apps/api/src/__tests__/chat-approval-bridge-loop.test.ts`). What is still true in
production:

1. **Nothing notifies when an approval parks.** `PlatformIngress.submit()` step 6
   (`packages/core/src/platform/platform-ingress.ts:270-321`) persists the
   `pending_approval` trace, creates the gated lifecycle via
   `lifecycleService.createGatedLifecycle(...)`, and returns
   `{ approvalRequired: true, lifecycleId, bindingHash }`. No notifier port exists on
   `PlatformIngressConfig`; no `.notify(` call exists anywhere in the parking path. The
   verified `.notify(` call sites are the legacy orchestrator
   (`propose-pipeline.ts:815`, `plan-pipeline.ts:276`, a different approval surface)
   and the escalation handoff chain (`handoff-notifier.ts:16`, `escalate.ts:76`).
2. **The bootstrap notifier chain serves escalations, not parked approvals.**
   `apps/api/src/bootstrap/skill-mode.ts:199-240` builds Email + Telegram notifiers and
   hands them ONLY to `HandoffNotifier` (the escalate tool). Telegram outbound is
   undeliverable for approvals regardless (64-byte `callback_data` cap vs the ~160-byte
   payload); `HandoffNotifier` sends `bindingHash: ""`, which the payload parser
   rejects, so that chain could never have produced a working button.
3. **`SlackApprovalNotifier` exists, parser-compatible, constructed nowhere.**
   `packages/core/src/notifications/slack-notifier.ts` posts bot-token
   `chat.postMessage` blocks whose button values are exactly
   `JSON.stringify({ action, approvalId, bindingHash })`, the three keys
   `parseApprovalResponsePayload` accepts. Three defects keep it from production duty:
   (a) it targets `notification.approvers` as Slack conversation ids, and parked
   lifecycles carry `approvers: []` (`DEFAULT_ROUTING_CONFIG.defaultApprovers` is
   empty), so it would silently no-op; (b) delivery failures are fully silent
   (`Promise.allSettled` with no inspection, no `response.ok` check, and no check of
   Slack's `{ ok: false }` envelope, which arrives with HTTP 200); (c) it renders
   Approve/Reject buttons even when `bindingHash` is empty, and a tap on such a button
   parses to null and falls through to the LLM conversation path as raw JSON text.
4. **The tap identity seam is broken for Slack.** The inbound adapter correctly
   surfaces `principalId = user.id` (U...) and `threadId = channel.id` (C.../D...) for
   block_actions (`apps/chat/src/adapters/slack.ts:131-148`, pinned by
   `slack-block-actions.test.ts`), but `managed-webhook.ts:166-177` forwards only
   `sessionId = threadId ?? principalId` into the gateway, and the gateway's approval
   branch uses `channelIdentifier: message.sessionId`
   (`channel-gateway.ts:169-187`). So a Slack tap presents the CHANNEL id as the
   binding identity, while the gateway's own contract comment and the bridge spec
   (section 5, seeding rules) demand the stable channel USER id (U...). A binding
   seeded per spec with U... can never match a tap that presents C...: every Slack tap
   would refuse `not_authorized` even with everything else wired.
5. **The transport seams are sound.** Slack interactivity arrives form-encoded and is
   unwrapped (with `rawBody` preserved for signature verification) by the content-type
   parser at `apps/chat/src/main.ts:69-82`; signature verification runs in
   `managed-webhook.ts` before parsing; Slack button values cap at 2000 bytes and the
   payload is ~160. Managed Slack channels are per-org BYO Slack apps
   (`DeploymentConnection.credentials = { botToken, signingSecret }`,
   `runtime-registry.ts:176-185`), which constrains who may post button messages
   (section 5).

## 2. Decision 1: where notifications fire. CHOSEN: an injected notifier port on PlatformIngress, fired at park time

**Options considered**

- A. Observe parked submissions at call sites (API routes, chat bridge, cron
  dispatchers) and notify from the API bootstrap. REJECTED: `submit()` has many
  callers (routes, the chat ingress adapter, cron workflows, the delegation
  submitter), each would need its own observer, and any missed one is a silent
  notification gap. It is exactly the "parallel notification system bolted on at
  routes" that the doctrine forbids.
- B. Notify inside `ApprovalLifecycleService.createGatedLifecycle`. REJECTED: the
  lifecycle service is storage orchestration. It does not hold the WorkUnit, the
  governance decision, or the routing config, so the notification content (intent,
  actor, risk, expiry) would have to be threaded into a storage seam that
  deliberately knows nothing about presentation.
- **C. An optional `approvalNotifier?: ApprovalNotifier` on `PlatformIngressConfig`,
  fired in step 6 immediately after `createGatedLifecycle` returns** (chosen).

**Why C:** PlatformIngress is the canonical chokepoint; every governed mutating action
already passes through it, so notify-at-park covers every present and future caller by
construction. Core already owns the `ApprovalNotifier` port and the
`ApprovalNotification` shape (`packages/core/src/notifications/notifier.ts`); core
stays surface-agnostic (it sees a port, never a channel), and the API bootstrap injects
the Slack implementation. Approval is lifecycle state; the notification fires from the
same code that creates that state, with the same data, atomically ordered after the
lifecycle exists (a tap can never race a lifecycle that is not yet written).

Mechanics:

- Fire-and-forget with logged failure, matching the legacy orchestrator precedent
  (`propose-pipeline.ts:815`): `.notify(notification).catch(err => console.error(...))`
  wrapped in try/catch so a synchronously-throwing notifier also cannot fail the park.
  The submit response does not wait on Slack; a notification failure never breaks
  parking. The Inbox remains canonical when a notification is missed.
- Fires ONLY on the lifecycle branch (`lifecycleService` configured, which production
  always is: `apps/api/src/app.ts:648`). The legacy no-lifecycle park return
  (`platform-ingress.ts:320`) does not notify: with no lifecycle there is no id the
  respond path could act on, and a button that cannot work is worse than no message.
- `NoopNotifier` / absent port: zero behavior change for every existing construction
  site (the config field is optional).

## 3. Decision 2: notification content and the payload contract

The notification is built at park time from data already in scope (verified at
`platform-ingress.ts:282-317`):

| ApprovalNotification field | Value at park                                                                                                           | Why                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `approvalId`               | `lifecycle.id`                                                                                                          | The respond fallback leg resolves lifecycle ids; e2e-proven by the bridge suite (taps drive `approvalId = parked.lifecycleId`).                                                                                                                                    |
| `envelopeId`               | `workUnit.id`                                                                                                           | Matches the lifecycle's `actionEnvelopeId`; rendered as context only.                                                                                                                                                                                              |
| `summary`                  | `` `${workUnit.intent} (requested by ${workUnit.actor.id})` ``                                                          | The established summary convention (`summary-builder.ts`, and the exact shape the bridge tests seed).                                                                                                                                                              |
| `riskCategory`             | normalized to the four known categories (`critical/high/medium/low`); anything else, including absent, becomes `medium` | A free-form cast would hide schema drift; the normalizer makes the fallback explicit and testable.                                                                                                                                                                 |
| `explanation`              | `` `Approval level: ${decision.approvalLevel}. Policies: ${decision.matchedPolicies.join(", ") \|\| "default"}.` ``     | Terse. The dashboard is the detail surface.                                                                                                                                                                                                                        |
| `bindingHash`              | `revision.bindingHash`                                                                                                  | The CURRENT revision's hash. A later patch creates a new revision; the old button then refuses `stale`, honestly.                                                                                                                                                  |
| `expiresAt`                | the same `expiresAt` written to the lifecycle                                                                           | One clock.                                                                                                                                                                                                                                                         |
| `approvers`                | `routingConfig.defaultApprovers` when non-empty, else `decision.approvers`                                              | Explicit rule: routing config wins (it is what the scope snapshot enforces), the governance decision's approvers inform when routing is silent. Informational in the pilot: Slack targeting is the configured conversation and never reads this field (section 5). |
| `evidenceBundle`           | `{ intent, organizationId }`                                                                                            | Minimal. WorkUnit parameters never enter notification copy.                                                                                                                                                                                                        |

The Slack message keeps the existing block layout (header with risk emoji, Risk +
Expires fields, Summary + Reason section, envelope context line, Approve + Reject
buttons). Button values are exactly `JSON.stringify({ action, approvalId,
bindingHash })`, `action_id` stays `approval_approve` / `approval_reject` (display
routing only; the value is the payload carrier). Approve and Reject only: chat cannot
patch, and the parser rejects anything else. Expiry renders as minutes under 3 hours
and whole hours at or above (the production default expiry is 24 hours;
"1440 minutes" is noise). When the message renders alert-only (empty bindingHash,
section 6 item 3), a context line tells the operator what to do instead:
"This approval cannot be actioned from Slack. Open the Inbox to review." No
em-dashes in any copy. The mechanical summary shape is accepted for the pilot;
enriching it from the work unit and evidence bundle is a named follow-up (section 8).

## 4. Decision 3: tap identity. CHOSEN: surface the stable channel user id through the gateway input

**Options considered**

- A. Make the Slack adapter put the user id in `threadId` for block_actions.
  REJECTED: `threadId` is the reply target (`sendTextReply(threadId, ...)`). The
  honest reply must land in the conversation where the tap happened, not jump to a
  different DM.
- B. Re-map `sessionId` for approval-shaped payloads in the webhook route. REJECTED:
  the route would have to parse approval payloads to detect them, duplicating gateway
  logic in a layer that should only transport.
- **C. Add optional `principalId` to `IncomingChannelMessage`; the managed webhook
  forwards `incoming.principalId`; the gateway approval branch binds on
  `message.principalId ?? message.sessionId`** (chosen).

**Why C:** it makes the gateway's documented contract real instead of aspirational.
Conversation keying (`sessionId`), conversation persistence, and reply routing are
untouched; only the approval branch's `channelIdentifier` changes, and only when the
adapter supplied a distinct stable identity. Per-channel effect:

- WhatsApp: `principalId === threadId === phone` (`whatsapp-parsers.ts`), so the
  binding identity is byte-identical before and after. No behavior change.
- Slack: taps and messages bind on the U... user id. Bindings are seeded with U...,
  exactly as bridge spec section 5 already instructs.
- Telegram: binds on `from.id` (the user) rather than `chat.id` (the conversation),
  which is the doctrine-correct identity if Telegram outbound ever lands. In DMs the
  two are numerically equal; no pilot behavior change.
- Web widget (`endpoints/widget-messages.ts`) passes no `principalId`; the fallback
  preserves today's behavior exactly.

The single-tenant Telegram path in `apps/chat/src/main.ts` also forwards
`principalId` for contract consistency, though its gateway remains approval-unwired by
design (bridge spec section 5).

**Binding-seeding contract (restated for the deploy notes):** the
`OperatorChannelBinding` row for a Slack operator is
`(organizationId, channel: "slack", channelIdentifier: "<U... user id>")`. Channel ids
(C.../D...) in binding rows never match and fail closed to `not_authorized`.

## 5. Decision 4: credentials and tenancy. CHOSEN: env-gated global notifier, pilot posture

**Options considered**

- **A. Env-gated global notifier constructed once in the API bootstrap** (chosen):
  reuse `SLACK_BOT_TOKEN` (already in the env allowlist, already documented in
  `.env.example:97-101`, already read by the API process at `app.ts:378` for
  `ProactiveSender`, same semantic: the Slack app's bot token) plus ONE new variable
  `SLACK_APPROVAL_CHANNEL` (the conversation the approval messages post to: a private
  ops channel id `C...`, or a user id `U...` for DM delivery). Both present: notifier
  constructed. Either missing: port stays undefined, parking notifies nothing, a boot
  log says so. This is exactly the `TELEGRAM_BOT_TOKEN` + `ESCALATION_CHAT_ID` shape
  the bootstrap already uses.
- B. Org-scoped notifier resolving the org's Slack `DeploymentConnection` credentials
  per notification, targeting bound operators by DM. REJECTED for this slice: it adds
  credential decryption at notify time, per-org delivery semantics, and a per-org
  target-resolution design (which conversation?) that the pilot (one org) does not
  need. It is the named multi-tenant follow-up, and the port chosen in Decision 1 is
  exactly where it would plug in.

**The same-app constraint, stated plainly.** Slack delivers block_actions to the
interactivity URL of the app that POSTED the message. Managed Slack channels are
per-org BYO apps whose events/interactivity URLs point at
`/webhook/managed/:webhookId`. Therefore `SLACK_BOT_TOKEN` MUST be the bot token of
that same org Slack app, or taps on notifier-posted buttons go to the wrong app and
never reach the gateway. For the pilot (one org) this is one constraint to honor when
setting the env var; it is also the structural reason posture B is the eventual
multi-tenant shape. The deploy notes carry this requirement, the builder's enable log
restates it ("ensure this bot token belongs to the same Slack app whose interactivity
URL routes to the managed webhook"), and the pre-flip checklist treats posting alone
as insufficient validation: a real button tap must round-trip before the pilot relies
on it.

Construction lives in a new `apps/api/src/bootstrap/approval-notifier.ts` (a pure,
testable builder), injected at the existing `PlatformIngress` construction in
`app.ts`. `skill-mode.ts` and its escalation chain are untouched: parked-approval
notifications and escalation handoffs are different surfaces with different payload
semantics (working buttons vs alert-only), and composing Slack into the escalation
chain is explicitly out of scope.

## 6. Notifier hardening (same class, three fixes)

1. **Deterministic targeting.** `SlackApprovalNotifier` gains
   `options.defaultConversationId`. When set, the notification posts there (the
   configured operator surface wins; `approvers` is ignored for targeting). When
   unset, the legacy approvers-as-conversation-ids behavior remains for backward
   compatibility. The bootstrap always sets it.
2. **Logged-not-thrown delivery failure.** `postMessage` checks both the HTTP status
   and Slack's `{ ok: false, error }` envelope and throws internally (a non-JSON or
   empty body from a proxy also surfaces here, as the json() rejection); `notify()`
   inspects per-target results and logs failures with `console.error` including the
   `approvalId` AND the target conversation id (operational identifiers, useful for
   debugging; never the bindingHash, never message content). `notify()` itself never
   rejects with a delivery error, and the park path additionally guards (Decision 1),
   so failure is observable in logs and harmless to the action.
3. **Buttons only when actionable.** The actions block renders only when
   `bindingHash` is non-empty. An empty hash (the `HandoffNotifier` shape) produces an
   alert-only message instead of buttons whose taps would fall through to the LLM as
   raw JSON text, plus the context cue from section 3 so the operator knows to use
   the Inbox.

## 7. Degraded modes and activation

| condition                                                        | behavior                                                                                                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SLACK_BOT_TOKEN` or `SLACK_APPROVAL_CHANNEL` unset              | No notifier injected; parking behaves exactly as today; boot log states notifications are off.                                                                                      |
| Slack API down / token revoked / channel archived                | Park succeeds; notification failure logged with approvalId; Inbox shows the approval.                                                                                               |
| Notification delivered, binding missing                          | Tap refuses `not_authorized` (bridge behavior, correct dark state).                                                                                                                 |
| Notification delivered, approval already responded via dashboard | Tap replies ALREADY_RESPONDED_MSG (engine-owned, proven).                                                                                                                           |
| Approval patched after notification                              | Old button's hash is stale; tap replies STALE_MSG (current-revision check, proven).                                                                                                 |
| Approval expired                                                 | Tap replies STALE_MSG via the expired refusal (proven).                                                                                                                             |
| Wrong app's token in env (same-app constraint violated)          | Buttons render but taps never arrive at the managed webhook. Detection: no gateway log line for the tap. Deploy notes call this out; the only fix is using the managed app's token. |

Activation is env-gated and dark by default: the wiring PR (last in the train) changes
nothing until both env vars are set on the API service. Pre-flip checklist (in the
wiring PR body): respond bridge live (it is, since #910), binding row seeded with the
U... id, `SLACK_BOT_TOKEN` = the managed org app's token, `SLACK_APPROVAL_CHANNEL` set
to the ops conversation, bot invited to that conversation (`channel_not_found` /
`not_in_channel` otherwise, visible in API logs), then one real parked approval
round-tripped END TO END: a successful post is NOT sufficient validation, because the
wrong app's token still posts fine (row 7 above); only a real button tap that reaches
the gateway and replies honestly proves the loop. The PR-4 body also states the
visibility/authority split explicitly: Slack channel membership does not grant
approval authority; the binding store remains the enforcement point.

## 8. Scope

IN:

- Core: notifier port on `PlatformIngressConfig` + park-time notification build and
  fire; `SlackApprovalNotifier` hardening (targeting, honest failure, no buttons
  without hash); `IncomingChannelMessage.principalId` + gateway approval-branch
  binding identity.
- Chat: managed-webhook (and single-tenant main.ts) forward `principalId`.
- API: `bootstrap/approval-notifier.ts` builder + injection; `.env.example` +
  `scripts/env-allowlist.local-readiness.json` for `SLACK_APPROVAL_CHANNEL`.
- Tests at every seam (section 9) including an e2e notify-to-dispatch proof.
- Deploy notes (the pre-flip checklist above).

OUT (each named, none silent):

- WhatsApp outbound approval notifications: operator pushes outside a 24h session are
  Meta-template-gated; a product/compliance design of its own.
- Telegram outbound: 64-byte `callback_data` cap needs short-token indirection (the
  bridge spec's named follow-up).
- Multi-tenant org-scoped delivery (posture B above): the notifier port is where it
  plugs in later.
- Binding admin UI: seeding stays SQL (bridge spec section 5 documents the INSERT).
- Retry/queueing for notification delivery: best-effort send + logged failure matches
  the existing notifier-chain posture; the Inbox is the canonical surface when a
  notification is missed.
- Composing Slack into the escalation handoff chain (`skill-mode.ts`), and the legacy
  orchestrator's `ctx.approvalNotifier` surface: untouched.
- Updating the Slack message in place after a response (nice-to-have; the honest
  in-thread reply already closes the loop).
- Operator-friendly summary enrichment (deriving human copy from the work unit and
  evidence bundle): the mechanical `intent (requested by actor)` shape ships for the
  pilot; enrichment is a named follow-up.

## 9. Tests (co-located, TDD; api tests use mocked Prisma; core uses in-memory stores)

- **core, slack-notifier suite** (extends the existing file): the built Approve and
  Reject button values fed through the REAL `parseApprovalResponsePayload` parse
  non-null with exactly `{action, approvalId, bindingHash}` (mutation check: a
  four-key or truncated value must parse null and the test must red);
  `defaultConversationId` wins over approvers; empty approvers + no default = no
  post; HTTP failure and `{ok:false}` envelope are logged via `console.error` with
  the approvalId AND the target conversation, and `notify()` resolves; empty
  `bindingHash` renders no actions block AND renders the Inbox cue line; expiry
  renders minutes under 3h and hours at/above.
- **core, platform-ingress-approval-notify suite** (new file, sibling to the existing
  focused ingress suites): a `require_approval` submit with a lifecycle service fires
  exactly one notification carrying `approvalId === lifecycle.id`,
  `bindingHash === revision.bindingHash`, the workUnit intent in the summary
  (substring assertions, not locked copy), and the lifecycle's `expiresAt`; an
  `execute` submit fires nothing; a `deny` fires nothing; no notifier configured =
  parking unchanged (mutation check: removing the hook call must red the fired test);
  a notifier whose `notify` rejects, and one that throws synchronously, both leave
  the submit response and lifecycle creation intact with the failure logged (async
  assertions via `vi.waitFor`, not bare timer flushes); approver fallback rule
  (routing config empty + decision approvers present = decision approvers in the
  notification); an unknown `riskCategory` value on the decision normalizes to
  `medium`.
- **core, channel-gateway approval branch** (extends `channel-gateway-approval.test.ts`):
  an approval-shaped message with `principalId` set reaches the respond path with
  `channelIdentifier === principalId`; without `principalId` it uses `sessionId`
  (WhatsApp regression pin); conversation flow for non-approval messages ignores
  `principalId` entirely.
- **chat, managed-webhook mapping** (extends the webhook suite): a signed Slack
  block_actions POST reaches the gateway with `sessionId = channel id` AND
  `principalId = user id`; an events-API message maps the same way; WhatsApp messages
  map `principalId === sessionId`. Production-encoding realism: the interactivity
  parser registration is extracted from `main.ts` into
  `apps/chat/src/routes/slack-form-parser.ts` so the suite can drive the REAL
  parser, and one leg posts a genuine `application/x-www-form-urlencoded`
  `payload=<json>` body with a REAL HMAC signature computed over the RAW form body
  (the exact wire shape Slack sends), proving form decode, rawBody preservation for
  signature verification, and identity forwarding in one pass.
- **api, bootstrap builder suite** (new): both envs set = notifier constructed with
  the right token and conversation; either missing = undefined + the boot log line;
  no throw in any combination.
- **api, e2e notify-to-dispatch proof** (new, over the bridge world from
  `chat-approval-world.ts` / `recommendation-handoff-lifecycle-world.ts`): inject a
  REAL `SlackApprovalNotifier` (stubbed global fetch capturing `chat.postMessage`
  bodies) into the harness ingress; park the real Riley handoff via the real cron
  path; assert the captured message targeted `SLACK_APPROVAL_CHANNEL`'s value and its
  approve button value, fed through the REAL parser, equals
  `{action: "approve", approvalId: <lifecycleId>, bindingHash: <current hash>}`; then
  drive that parsed payload through the REAL `handleApprovalResponse` in transport
  mode over the REAL internal route with a slack-flavored U... binding fixture; assert
  THE HANDLER RAN (Mira job exists via the real read model), trace completed,
  `approvalRespondedBy` is the bound principal, DispatchRecord succeeded, reply is
  APPROVE_EXECUTED_MSG. Reject leg: the reject button value ends the lifecycle
  rejected with REJECT_SUCCESS_MSG and zero dispatches. Delivery-failure leg: a
  notifier whose fetch 500s still parks and the harness sees the logged error, not a
  throw.
- **Mutation checks** (each verified RED once during TDD): malform the button JSON
  (extra key) and the parser-compat test reds; skip the park-hook call and the
  ingress-notify test reds; drop the `principalId ?? sessionId` fallback change and
  the gateway identity test reds; drop the `{ok:false}` check and the logged-failure
  test reds.

## 10. Delivery: four sequential, file-disjoint PRs after this spec lands

1. **PR-1 core notifier + park hook**: `slack-notifier.ts` (hardening),
   `notifications/__tests__/slack-notifier.test.ts`, `platform/platform-ingress.ts`
   (port + fire), `platform/__tests__/platform-ingress-approval-notify.test.ts` (new).
2. **PR-2 identity seam**: `channel-gateway/types.ts` (`principalId`),
   `channel-gateway/channel-gateway.ts` (approval-branch identity + contract comment),
   `channel-gateway/index.ts` (export the payload parser for the e2e proof),
   `channel-gateway/__tests__/channel-gateway-approval.test.ts`,
   `apps/chat/src/routes/managed-webhook.ts`,
   `apps/chat/src/routes/slack-form-parser.ts` (new; parser extraction),
   `apps/chat/src/main.ts` (consume the extracted parser + one principalId line),
   chat webhook tests including the form-encoded leg.
3. **PR-3 e2e proof**: `apps/api/src/__tests__/slack-approval-notify-loop.test.ts`
   (new) + the one-field harness extension (`recommendation-handoff-harness.ts` gains
   an optional `approvalNotifier` passthrough). Proof lands BEFORE activation.
4. **PR-4 api wiring (the activating PR, last)**:
   `apps/api/src/bootstrap/approval-notifier.ts` (new) + builder tests, `app.ts`
   injection, `.env.example`, `scripts/env-allowlist.local-readiness.json`. Dark until
   both env vars are set on Render; PR body carries the pre-flip checklist (section 7)
   and the visibility/authority statement.

PR-2 is compile-independent of PR-1; PR-3 depends on PR-1 (the port and notifier
options) and PR-2 (the parser barrel export); PR-4 depends on PR-1. Landing order is
1, 2, 3, 4 to keep the train sequential and each diff reviewable against main.

## 11. Risks and honest limits

- **Single operator surface.** Every parked approval across every org notifies ONE
  configured conversation. Correct for the pilot (one org); the multi-tenant gap is
  posture B, deliberately deferred, and the port is where it lands.
- **The same-app constraint is operational, not enforced in code.** A wrong token
  renders buttons that tap into the void (section 7 row 7). The pre-flip checklist's
  round-trip step catches it before operators depend on it.
- **No notification retries.** A Slack outage during a park means no message (logged).
  The Inbox shows the approval; the expiry clock still runs. Accepted posture, shared
  with every existing notifier.
- **Chat-turn parks notify too.** Any governed intent that parks (not only the Riley
  handoff) produces a notification. That is the design (the operator loop is general),
  but pilot volume should be watched; a noisy gate would make the ops channel loud.
- **Telegram/WhatsApp outbound remain dark** (named follow-ups, section 8). The
  Telegram notifier still emits over-cap callback_data if ever constructed; it stays
  unconstructed.
- **The notification is unauthenticated surface area in the ops channel.** Anyone in
  that channel sees summaries (intent + actor id + risk; never parameters). Channel
  membership is the access control, stated here so the pilot chooses the channel
  deliberately. Taps remain useless without a seeded binding.
