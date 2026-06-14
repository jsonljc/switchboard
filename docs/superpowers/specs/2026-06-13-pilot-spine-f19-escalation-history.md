# Spec + plan: F-19 escalation detail shows no lead/agent conversation history

- Date: 2026-06-13
- Blocker: pilot-spine audit finding F-19 (`docs/audits/2026-06-07-pilot-spine-audit/findings/F-19-escalation-history-wrong-table.md`)
- Severity: blocks-pilot (violates the "Human escalation is first-class architecture" core invariant)
- Branch: `fix/escalation-history-source`
- Scope: `apps/api` only. No schema migration. No producer change. No dashboard change.

## The finding, verified against current origin/main (5cb128fb)

`GET /api/escalations/:id` built `conversationHistory` from
`prisma.conversationState.findFirst({ where: { threadId: handoff.sessionId, organizationId } }).messages`
(`apps/api/src/routes/escalations.ts:106-113`). The operator opening a real
WhatsApp handoff saw an empty transcript. Confirmed still present on
`origin/main` at 5cb128fb.

The audit framed this as a "wrong table" read. That is correct but incomplete.
The deeper root cause (found while verifying the producer chain) is that
**`Handoff.sessionId` is the WorkUnit `traceId`, not a conversation/session key**:

- `escalate.ts:71` sets `Handoff.sessionId = ctx.sessionId`.
- `skill-request-context.ts:11` sets `ctx.sessionId = params.sessionId`.
- `skill-mode.ts:94` passes `sessionId: workUnit.traceId ?? workUnit.id` into the
  executor params. So `ctx.sessionId == workUnit.traceId`.
- `work-unit.ts:46` sets `traceId: request.traceId ?? createId()`, and the
  channel gateway never sets `request.traceId` (`channel-gateway.ts:315-346`),
  so on the managed path the traceId is a fresh random cuid per turn.

Therefore `Handoff.sessionId` is a random per-turn cuid. It does NOT equal
`ConversationState.threadId` (the gateway session id, e.g. the WhatsApp phone)
nor `ConversationThread.agentContext.sessionId` (also the gateway session id).
The original `ConversationState`-by-`sessionId` read could never match on the
managed path, which is why the audit could not drive it end to end.

## The only usable lineage: WorkTrace

`ConversationMessage` (the managed-channel transcript, written by the gateway in
`gateway-conversation-store.ts:85-93`) is keyed by `contactId` + `orgId`. The
one place that ties the per-turn `traceId` to that `contactId` is the WorkTrace
the gateway already populates for every turn:

- `work-trace-recorder.ts:89` writes `traceId: workUnit.traceId` (so
  `WorkTrace.traceId == Handoff.sessionId`).
- `work-trace-recorder.ts:119` writes `contactId: workUnit.contactId`, and
  `work-unit.ts:49` sets `workUnit.contactId = request.contactId`, which the
  gateway sets to `identity.contactId` (`channel-gateway.ts:344`). So the
  escalating turn's WorkTrace carries the contact id.
- `WorkTrace` indexes `traceId` and `[organizationId, contactId]`
  (`schema.prisma`), so the lookups are index-backed.

Chain: `handoff.sessionId` -> `WorkTrace` (by `traceId`, org-scoped) ->
`contactId` -> `ConversationMessage` (by `contactId` + `orgId`) -> transcript.

## Decision (consumer-only, lowest blast radius)

In `GET /api/escalations/:id`, replace the dead `ConversationState`-by-sessionId
read with:

1. Resolve `contactId` from the escalating turn's WorkTrace:
   `workTrace.findFirst({ where: { traceId: handoff.sessionId, organizationId: orgId, contactId: { not: null } }, orderBy: { requestedAt: "desc" }, select: { contactId: true } })`.
   The `contactId: { not: null }` filter and `orderBy` keep it deterministic if
   sibling traces share a traceId.
2. Read the transcript from `ConversationMessage`
   (`where: { contactId, orgId }`, `orderBy createdAt desc`, `take` a bounded
   cap, then reverse to chronological), mapping `direction "inbound" -> role
"user"` (lead), `"outbound" -> "assistant"` (agent), `content -> text`,
   `createdAt -> timestamp` (ISO). This matches the consumer view model
   (`use-escalation-detail.ts:16-20`) and the sheet, which already renders
   `user`/`assistant`/`owner` (`handoff-detail-sheet.tsx:178-187`).

Both lookups are org-scoped (TI-5/TI-6): `WorkTrace.organizationId` and
`ConversationMessage.orgId`. The `take` cap bounds an otherwise unbounded read on
a long thread.

Operator turns (`ConversationState.messages`) are intentionally NOT merged in:
that read was keyed on `handoff.sessionId` (a traceId) and so never returned
anything on the managed path, and the operator-reply writer is broken by the
same traceId mismatch (a separate, out-of-scope finding to report). The F-19
defect is the missing lead/agent transcript, which `ConversationMessage`
provides in full, already chronologically ordered by the database.

### Rejected alternatives

- Resolve `contactId` via `ConversationThread` keyed on
  `agentContext.sessionId == handoff.sessionId`. This is a NO-OP: that field
  holds the gateway session id, not the traceId in `Handoff.sessionId`. (This
  was the first attempt; a producer-chain trace disproved it.)
- Capture `contactId` on the Handoff at escalate time (`ctx.contactId` is
  available) via a new `Handoff.contactId` column or by reusing `leadId`.
  Cleaner read, but it crosses schemas + core + db + api and needs a migration
  (or a semantic overload of `leadId`). Higher blast radius for no extra pilot
  benefit, since the WorkTrace lineage already carries the contact id. Rejected.

## Test strategy (TDD)

`apps/api/src/routes/__tests__/escalation-history-source.test.ts`, driving
`GET /api/escalations/:id` through `buildConversationTestApp` with a mocked
prisma (`handoff.findUnique`, `workTrace.findFirst`, `conversationMessage.findMany`).
RED first.

1. Lead and agent turns render from `ConversationMessage` once the contact is
   resolved from the WorkTrace (inbound -> user, outbound -> assistant, text,
   timestamp). Pins the producer -> consumer seam.
2. The WorkTrace lookup is keyed by `traceId == handoff.sessionId`, org-scoped,
   and filters `contactId not null`.
3. The `ConversationMessage` lookup is org-scoped (`orgId`) and bounded (`take`).
4. Fallbacks: no WorkTrace / no contactId -> `[]` (no throw); no messages -> `[]`.

Update `escalations-cross-tenant.test.ts` to the new lookup path, asserting
org-scoping on both `WorkTrace` and `ConversationMessage`, and that a
cross-tenant Handoff still 404s before any conversation read.

## Verification gate

`pnpm typecheck` + `pnpm --filter @switchboard/api test` + `pnpm build` +
`pnpm lint` + `pnpm format:check`, all green. Adversarial review + independent
correctness / consumer-contract / merge-mechanics checks before merge.
