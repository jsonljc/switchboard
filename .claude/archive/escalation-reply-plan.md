# escalation-reply dual-path fix — TDD plan (ephemeral loop scratch, uncommitted)

Worktree: `.claude/worktrees/escalation-reply`, branch `fix/escalation-reply-dual-path`, baseline `373cdc61`.
Design brief (bug detail): `.claude/escalation-reply-brief.md`. This file = the RESOLVED design + TDD steps.

## Bug (one line)

`POST /api/escalations/:id/reply` calls `releaseEscalationToAi({ threadId: handoff.sessionId, ... })`; for escalate-tool handoffs `sessionId = traceId`, which keys NO ConversationState row -> `ConversationStateNotFoundError` -> 404. The owner reply never reaches the customer. Gateway-gate handoffs (`sessionId = phone`) have a phone-keyed ConversationState so they avoid the 404 (must NOT regress).

## Resolved facts (from 2 archaeology passes; executors trust these, verify the exact lines as they go)

- **No ConversationState row exists on the escalate-tool path** at reply time (the api skill-mode adapter `apps/api/src/bootstrap/skill-mode.ts:211` is update-only; the traceId-keyed status write is a silent no-op). So the owner reply must be written to **ConversationMessage** (the canonical transcript the GET reads: `escalations.ts` GET block ~`:138-148`, written by `apps/chat/src/gateway/gateway-conversation-store.ts:85-93`), and any ConversationState status flip is BEST-EFFORT (skip cleanly when no row).
- **Delivery on the contact path:** `agentNotifier.sendProactive(destinationPrincipalId, channel, msg)` passes `destinationPrincipalId` STRAIGHT to the WhatsApp Graph API `to` field, no parsing (`packages/core/src/notifications/proactive-sender.ts:~154`). So pass `contact.phoneE164` (already normalized E164) directly. Source `channel` from `contact.primaryChannel` (defaults `"whatsapp"`). (The gateway path passes `visitor-<rawdigits>` as `to` = a SEPARATE pre-existing delivery bug; out of scope.)
- **Contact resolution:** mirror the F-19 GET lineage read: `workTrace.findFirst({ where: { traceId: handoff.sessionId, organizationId, contactId: { not: null } } })` -> `contactId` (or null on the gateway path, which has no WorkTrace).
- **Sole production caller** of `releaseEscalationToAi`: `apps/api/src/routes/escalations.ts:~269`. **Arg/result-asserting tests** (ripple): `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts`, `escalations-cross-tenant.test.ts` (asserts NOT-called on miss), `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts`, `packages/core/src/platform/__tests__/conversation-state-store.test.ts` (interface stub). Also mock it (no arg-assert): `conversations-override.test.ts`, `no-direct-conversation-state-mutation.test.ts`, `conversations-send.test.ts`.
- Interface today: `ReleaseEscalationInput = { organizationId, handoffId, threadId, operator, reply:{text} }` (`packages/core/src/platform/conversation-state-store.ts:~38`); `ReleaseEscalationResult = { channel, destinationPrincipalId, workTraceId }`.

## Design (smallest doctrine-compatible; no gateway-path regression)

Replace the single `threadId` with a discriminated `target`:

```ts
type ReleaseEscalationTarget =
  | { contactId: string } // escalate-tool path: ConversationMessage write + Contact delivery
  | { threadId: string }; // gateway path: EXISTING ConversationState behavior, unchanged
type ReleaseEscalationInput = {
  organizationId;
  handoffId;
  operator;
  reply: { text };
  target: ReleaseEscalationTarget;
};
```

Route (`escalations.ts` reply handler): resolve `contactId` via the WorkTrace read; set `target = contactId ? { contactId } : { threadId: handoff.sessionId }`; pass it to the store. Keep the existing released-flip position (minimal change); do NOT 404 the escalate path. If the store throws a genuine data gap (contact missing), return **502** ("reply saved/queued, delivery unresolved"), NOT 404 (404 stays for handoff-not-found / wrong-org).
Store (`prisma-conversation-state-store.ts` `releaseEscalationToAi`):

- `target.threadId` branch: byte-identical to today (lookup-or-throw, append to `.messages`, status `active` via org-scoped `updateMany`, audit WorkTrace, return ConversationState `channel`/`principalId`).
- `target.contactId` branch: read `Contact(id contactId, organizationId)` (throw a NEW typed `ContactNotFoundError` if missing — distinct from `ConversationStateNotFoundError`); write the owner reply to **ConversationMessage** with the REAL columns (verified vs `schema.prisma:981-993`): `{ contactId, orgId, direction: "outbound", content: input.reply.text, channel: contact.primaryChannel, metadata: { sender: "owner" } }` (NOT `organizationId`/`role`/`text`; `orgId` + `content` + the lowercase `"outbound"` string are load-bearing — wrong names render nothing in GET); BEST-EFFORT flip the phone-keyed ConversationState (`threadId = contact.phoneE164`) status->active via org-scoped `updateMany` (count:0 no-op is fine, do NOT throw — only gateway re-engagement reads status); audit WorkTrace (`recordOperatorMutation`, tx-aware, same as the thread branch); return the FULL `ReleaseEscalationResult` = `{ channel: contact.primaryChannel, destinationPrincipalId: contact.phoneE164, workTraceId, conversationId, appendedReply: { role, text: input.reply.text, timestamp } }` (read the result type at `conversation-state-store.ts:46-53` and how the route consumes `conversationId`/`appendedReply`; on the contact path there is no ConversationState so source `conversationId` from the ConversationMessage id or contactId per how the route uses it).
- Org-scope EVERY query (both branches). Reuse `this.workTraceStore.recordOperatorMutation`.

### Fan-out revisions (folded in 2026-06-14; graders: 2 REVISE + 1 PASS code-grounded)

- ConversationMessage columns = `orgId/direction("outbound")/content/channel/metadata` ONLY (no role/operator/timestamp). Owner marker goes in `metadata.sender:"owner"`.
- `ReleaseEscalationResult` also requires `conversationId` + `appendedReply{role,text,timestamp}` — contact branch returns the full shape or typecheck reds.
- 502 maps ONLY the new `ContactNotFoundError`; KEEP the existing `ConversationStateNotFoundError`->404 arm (separate `instanceof` arms, no blanket catch) so a genuine gateway data gap still 404s; handoff-not-found/wrong-org stay 404.
- Best-effort status flip keyed by `contact.phoneE164` (the phone = the gateway threadId), not contactId.
- ATTRIBUTION (deferred): GET maps `direction!=="inbound"`->`"assistant"`->agentName (`escalations.ts:144-147`), and the dashboard (`handoff-detail-sheet.tsx`) renders that as the agent. We write `metadata.sender:"owner"` (correct data) but do NOT change the GET/dashboard render this slice (they must change together; dashboard is a separate app). Owner-vs-agent label is a documented follow-up. Reply is delivered + persisted + GET-visible.
- Released-flip stays before the store call (route never gates on current status, so a 502'd handoff can be re-replied) — note the released-but-undelivered window in the PR.

## TDD steps (each: failing test first -> implement -> green -> tick). Dispatch core steps on OPUS (risky cross-pkg, customer-facing), mocks on sonnet/haiku.

- [ ] **Step 1 (core interface, opus): change `ReleaseEscalationInput` to the `target` union.** Update `packages/core/src/platform/conversation-state-store.ts` (input type + any interface doc). Update the interface stub test `packages/core/src/platform/__tests__/conversation-state-store.test.ts` to the new shape. Run `pnpm --filter @switchboard/core test -- conversation-state-store` -> green. Commit (explicit pathspecs, lowercase, co-author trailer).

- [ ] **Step 2 (db store, opus): implement both branches in `releaseEscalationToAi`.** RED: in `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts` add a contact-path test (target `{contactId}` -> reads Contact, writes ConversationMessage outbound, best-effort status no-op when no CState row, audit WorkTrace, returns `{channel: primaryChannel, destinationPrincipalId: phoneE164, workTraceId}`) and keep the existing thread-path test (now `target:{threadId}`) green. Read the real ConversationMessage create shape (grep `conversationMessage.create`/`addMessage`) before writing. Run `pnpm --filter @switchboard/db test -- prisma-conversation-state-store` -> RED then GREEN. Commit.

- [ ] **Step 3 (api route, opus): WorkTrace-resolve + target branch + miss=502.** RED: in `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts` add an escalate-tool happy path (WorkTrace resolves contactId -> store called with `target:{contactId}`, delivery via the returned phoneE164, 200/replySent) and a gateway fallback test (WorkTrace miss -> store called with `target:{threadId: sessionId}`, existing behavior). Update the existing arg-assert (`threadId:"sess-wa-123"` -> `target:{threadId:"sess-wa-123"}`). Add a contact-missing -> 502 (not 404) test. Edit `apps/api/src/routes/escalations.ts` reply handler: add the WorkTrace `findFirst` (mirror the GET block at ~:127-135), branch the target, and use SEPARATE catch arms: `instanceof ContactNotFoundError`->502, `instanceof ConversationStateNotFoundError`->404 (unchanged for the gateway path), handoff-not-found/wrong-org->404 (unchanged). The test harness `makePrisma()` (~:40-55) currently mocks only `handoff`; ADD `workTrace: { findFirst: vi.fn() }` returning `{contactId:"c1"}` for the escalate happy path and `null` for the gateway-fallback test. Run `pnpm --filter @switchboard/api test -- escalations-reply-delivery` -> RED then GREEN. Commit.

- [ ] **Step 4 (mocks, haiku/sonnet): update remaining `releaseEscalationToAi` mocks + the new route read.** (a) update input mocks to the `target` shape: `conversations-override.test.ts`, `no-direct-conversation-state-mutation.test.ts`, `conversations-send.test.ts` (and any other constructing the input); (b) the result-shape mocks must return the FULL `ReleaseEscalationResult` (`conversationId` + `appendedReply`) — likely already do, verify; (c) CRITICAL: add `workTrace: { findFirst: vi.fn().mockResolvedValue(null) }` to the REPLY-path prisma mocks in `escalations-cross-tenant.test.ts` and `no-direct-conversation-state-mutation.test.ts` — the new route `workTrace.findFirst` read throws `findFirst is not a function` without it (cross-tenant 404 cases short-circuit before the read, but the count:0/non-404 reply case reaches it). Run `pnpm --filter @switchboard/api test` -> green. Commit.

- [ ] **Step 5 (verify, opus): full gate.** `pnpm reset` (cross-layer change), then dispatch the verifier: `pnpm typecheck`; `pnpm --filter @switchboard/core test`, `--filter @switchboard/db test`, `--filter @switchboard/api test`; `pnpm test`; `pnpm lint`; `pnpm format:check`; `pnpm arch:check`; `pnpm build`. (No schema change -> no db:check-drift; no engine change -> no eval.) Three-dot diff `git diff origin/main...HEAD`. Adversarial `/code-review` on the diff. All green + review clean = DONE.

## Acceptance criteria

1. escalate-tool reply path: resolves contactId via WorkTrace, writes the owner reply to ConversationMessage (GET-visible), delivers via `contact.phoneE164`, returns success (not 404). 2. gateway-gate path: byte-identical behavior (regression test green). 3. unresolvable contact -> 502 not 404; handoff-not-found / wrong-org still 404. 4. cross-tenant tests green (org-scope both legs). 5. all gates green after `pnpm reset`.

## Runtime caveat (CONVERGE input)

No local WhatsApp sandbox -> the actual WA round-trip is unverifiable in CI. Mitigation: the escalate path is 404-broken today (any correct-by-code fix is strictly better, cannot regress it); the gateway path is untouched (byte-identical, tested); the contact-path `to`=phoneE164 is the form the Graph API expects (verified vs `proactive-sender.ts`). CONVERGE: auto-merge if CI+review green AND the gateway-no-regression test passes; surface the WA round-trip as a residual manual-validation milestone in the PR + report + memory.
