# Slice 2: gateway visitor-<phone> WhatsApp delivery fix — brief plan (ephemeral scratch)

Worktree: `.claude/worktrees/gateway-visitor-fix`, branch `fix/gateway-principal-deliverable`, baseline `26001bad` (origin/main).
Ledger: `.claude/pilot-launch-loop-state.md` (slice 2 row has the full root-cause).

## Fix (the whole change)

`packages/core/src/channel-gateway/pre-input-gate.ts` lines **161** and **318**: change `principalId: \`visitor-${sessionId}\``to`principalId: sessionId`.

## Why (airtight, FRAME-resolved)

- `ConversationState.principalId` is read back as `destinationPrincipalId` and POSTed straight to the WhatsApp Graph `to` (`prisma-conversation-state-store.ts:216` operator-send, `:309` escalation-thread-release -> `proactive-sender.ts:156`). `visitor-+<phone>` is not a valid `to`, so those sends silently fail.
- `principalId` is delivery DATA only: plain `String` (schema.prisma:132), NOT an FK, NOT unique, only `@@index`; every reader keys on `threadId`. Safe to change (FRAME Q1).
- `sessionId` is the deliverable address for every channel (the working bot-reply path already sends to it; proactive-sender routes the literal value per channel) (FRAME Q2).
- The NORMAL inbound path already mints `principalId = bare E.164` (managed-webhook.ts:192). Only the two gate sites add `visitor-`, and both upsert the SAME row (where `threadId=sessionId`). So the prefix is an existing INCONSISTENCY; this fix ALIGNS the gate path with the normal path (FRAME Q4).
- NOTHING consumes the `visitor-` prefix (grep: only the 2 mint sites + 2 comments; dashboard clean). No consumer breaks.
- Cannot regress: the gate-keyed delivery paths are broken TODAY (visitor-<phone> never delivers); matching the normal path is strictly better (same posture as escalation-reply #1040).

## TDD steps (opus; customer-facing delivery, runtime-unverifiable, so the test is the proof)

- [ ] **Step 1.** Read `pre-input-gate.ts` to identify the TWO code paths that reach :161 and :318 (two distinct gate conditions). Read the existing `pre-input-gate.test.ts` (and any test that exercises `setConversationStatus`/`conversationStatusSetter` with `upsertContext`).
- [ ] **Step 2 (RED).** Add/adjust a test asserting that the `upsertContext.principalId` passed to `setConversationStatus` equals `sessionId` (the bare deliverable), NOT `visitor-${sessionId}`, for BOTH gate paths. If an existing test asserts the `visitor-`-prefixed value, it was asserting the bug: update it to the bare `sessionId` (note this in the report). Run the test -> RED.
- [ ] **Step 3 (GREEN).** Apply the 2-line change (161, 318). Run -> GREEN.
- [ ] **Step 4 (chain check).** Confirm (read, no code) that the db store reads `principalId` as `destinationPrincipalId` unchanged, so the gate row now yields a deliverable `to`. Do NOT modify the store. If an existing db-store test hard-codes a `visitor-` principal as input, leave it (that test feeds its own value); only flag if one asserts a `visitor-` is delivered.
- [ ] **Step 5 (self-heal note, no code).** Check whether the normal-path upsert UPDATE branch writes `principalId` (gateway-bridge.ts / the store upsert). If yes: existing prod `visitor-` rows self-heal on the next normal inbound (write it in the PR). If no: dormant pre-fix rows stay stale -> document a one-line backfill as a follow-up (likely unneeded for the pilot: few/no prod rows). Either way, NO migration in this slice.

## Out of scope (documented)

- `gateway-conversation-store.ts:28` `contactId = identity?.contactId ?? visitor-${sessionId}` is a TRANSCRIPT contactId fallback (not a Graph `to`); different concern, left alone.
- Adding a Contact-resolve to the operator-send/thread-release paths (read-site fix) is non-viable without new wiring and unnecessary given the mint-site fix.

## Verify

`pnpm reset` then: `pnpm typecheck`; `--filter @switchboard/core test`; `--filter @switchboard/db test`; `pnpm test`; `lint`; `format:check`; `arch:check`; `build`. No schema change (no drift). `pnpm eval:governance`? NOT needed (pre-input-gate is the block-decision path, but this changes only the stored principalId string, not any gate/governance decision; confirm no eval fixture asserts the principal value). Three-dot diff + adversarial `/code-review`.

## Acceptance

1. Both gate sites mint `principalId = sessionId` (deliverable). 2. operator-send + escalation-thread-release now yield a real-phone `to`. 3. no consumer of the `visitor-` prefix broken (grep-clean). 4. all gates green. 5. self-heal behavior documented. Runtime WA round-trip remains the manual milestone.
