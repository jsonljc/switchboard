# escalation-reply slice — design brief (externalized)

Source: design-archaeology subagent, 2026-06-14, against origin/main. Condensed to decisions + index.

## Bug

`POST /api/escalations/:id/reply` (`apps/api/src/routes/escalations.ts:265-283`) calls
`conversationStateStore.releaseEscalationToAi({ threadId: handoff.sessionId, ... })`. But
`Handoff.sessionId` semantics DIFFER by producer:

- **escalate-tool handoff** (skill execution): `sessionId = workUnit.traceId` (`skill-mode.ts:94`, `escalate.ts:61-75`). The store does `conversationState.findFirst({ threadId })` -> NO match (no ConversationState keyed by traceId) -> `ConversationStateNotFoundError` -> 404. BROKEN.
- **gateway pre-input-gate handoff**: `sessionId = phone` (`managed-webhook.ts:179,189`); the safety-gate upserts a phone-keyed ConversationState (`gateway-bridge.ts:200-214`), so the lookup MATCHES. Old code accidentally works here. A fix must NOT regress this path.
- Gateway-gate handoffs may have NO WorkTrace (pre-input gate short-circuits before `platformIngress.submit`), so WorkTrace->contact resolution returns null for them -> MUST fall back to sessionId-as-threadId.

## Canonical store

`ConversationMessage` (keyed `contactId`+`orgId`) is the managed-transcript source of truth (gateway writes it: `gateway-conversation-store.ts:78-91`; GET reads it post-F-19). `ConversationState` is a status/control row keyed by `threadId` (phone); `.messages` is legacy/single-tenant and NOT read by gateway re-engagement (reads only status). So the owner reply currently lands in `ConversationState.messages` which GET never shows = latent inconsistency.

## releaseEscalationToAi does THREE things (store body `prisma-conversation-state-store.ts:222-300`)

1. lookup ConversationState by threadId (throws if missing, `:225-227`)
2. append owner reply to `.messages` + flip status human_override->active (org-scoped updateMany)
3. record audit WorkTrace `escalation.reply.release_to_ai`
   Route then delivers via `agentNotifier.sendProactive(destinationPrincipalId, channel, msg)` (`escalations.ts:296-309`).

## Recommended fix (dual-path)

1. Resolve contact via WorkTrace (mirror F-19 GET block `escalations.ts:128-162`): `workTrace.findFirst({ traceId: handoff.sessionId, organizationId, contactId:{not:null} })` -> contactId.
2. If contact resolved (escalate-tool path): key transcript write to ConversationMessage(contactId,orgId, direction outbound); flip phone-keyed ConversationState status->active; source phone+channel for delivery.
3. If WorkTrace miss (gateway-gate path): fall back to `handoff.sessionId` as threadId directly (existing behavior).
   Interface change: `ReleaseEscalationInput.threadId` -> `contactId` (+ fallback threadId?) in `packages/core/src/platform/conversation-state-store.ts:37-66`; impl in db; route passes contactId. Ripples to releaseEscalationToAi mocks across `apps/api/src/routes/__tests__/` (only escalations-reply-delivery.test.ts + the store test assert ARGS).

## OPEN UNCERTAINTIES (resolve before/at implementation; may need a 2nd archaeology pass)

- Does an escalate-tool handoff have ANY ConversationState row at reply time? If not, the status-flip has nothing to flip (need upsert, or skip status-flip and rely on ConversationMessage). UNCONFIRMED.
- destinationPrincipalId + channel sourcing on the contact path (Contact has phone; channel default whatsapp or from handoff.leadSnapshot.channel).
- Miss semantics: 404 vs 502 ("reply saved, delivery failed"). Handoff already flipped to released before store call (`escalations.ts:208`) -> consider resolving contact BEFORE flipping.
- RUNTIME-VERIFY GAP: no local WhatsApp sandbox; mocked CI cannot prove the two producer paths behave correctly at runtime. This is why this slice has a high bar + may be gated.

## Test seams (CI has no Postgres -> mocked Prisma)

- Route: `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts:102-108` (asserts threadId arg -> change to contactId; add WorkTrace-resolve happy path + gateway-gate fallback test).
- F-19 mirror: `escalation-history-source.test.ts:118-122` (WorkTrace where-shape).
- Cross-tenant: `escalations-cross-tenant.test.ts` (keep green; org-scope both legs).
- Store: `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts:237-291`.
- Guard: `no-direct-conversation-state-mutation.test.ts` (writes stay in store; route WorkTrace findFirst is a read = allowed).
- `pnpm reset` before final verify (cross-layer interface change).

## TDD plan: red route (contactId arg + fallback) -> green route+interface -> red/green store (contact-keyed + ConversationMessage write + status flip) -> mirror F-19 org-scope + miss-semantics -> full verify (reset, typecheck, core+db+api tests; update all releaseEscalationToAi mocks).
