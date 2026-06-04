# Chat-surface approval seam: one respond engine, honest replies

Date: 2026-06-04
Status: approved (autonomous slice, follows 2026-06-04-parked-approvals-inbox-design.md)
Proving case: chat-surface approve of the parked Riley -> Mira handoff (extends the #879 harness)

Governing invariant (inherited from the Inbox slice and now applied to every surface):
**a human approves exactly one frozen action, and the system either executes that exact
action or exposes the failed execution for recovery.** After this slice, NO approve leg
anywhere ends in bare `approveLifecycle`.

## 1. Problem

All facts verified against origin/main `fa2e16a7` (2026-06-04).

`respondToApproval` (`packages/core/src/approval/respond-to-approval.ts`) is the shared
respond helper for both `apps/api/src/routes/approvals.ts` and the chat gateway
(`packages/core/src/channel-gateway/handle-approval-response.ts`). Its lifecycle fork
(`respondViaLifecycle`, lines 283-316) calls `approveLifecycle`, materializes an
ExecutableWorkUnit, flips the envelope to "approved", and returns
`{ executionResult: { executableWorkUnitId } }` WITHOUT dispatching. Only the legacy fork
(no lifecycle row) reaches `platformLifecycle.respondToApproval` ->
`executeAfterApproval` (the real `modeRegistry.dispatch`). Any approval that has BOTH a
legacy ApprovalRequest row and an ApprovalLifecycle row for the same envelope id therefore
approves without executing: the trace stays `pending_approval`, nothing runs, no error
surfaces. The dashboard Inbox slice (#872-#879) deliberately did not touch this fork; it is
the last approve path that violates the invariant.

Audit deltas from the slice brief, each load-bearing for the design:

1. **The legacy approval store is Prisma-backed in production.** `bootstrapStorage`
   (`apps/api/src/bootstrap/storage.ts:45-53`) uses `createPrismaStorage`
   (`packages/db/src/storage/factory.ts`), which wires `PrismaApprovalStore`, whenever
   `DATABASE_URL` is set (so since 2026-03-09, commit `3f519c21`). The in-memory store is
   the dev-no-DB fallback only. The "approval rows do not survive a restart" aggravator is
   stale for production; it remains true for dev-no-DB. The §1.2 claim in the Inbox spec
   ("in-memory even in production") is likewise stale.
2. **The chat respond path is unwired in production.** `approvalResponseConfig`
   (`HandleApprovalResponseConfig`) is constructed nowhere outside tests. Both
   `ChannelGateway` construction sites (`apps/chat/src/main.ts` single-tenant,
   `apps/chat/src/gateway/gateway-bridge.ts` managed) omit it, so `handleApprovalResponse`
   fails closed with NOT_AUTHORIZED for every operator today. Additionally the chat
   process has no execution runtime (no `ExecutionModeRegistry`, no workflow handlers; all
   execution is delegated to the API process via `HttpPlatformIngressAdapter`), so a full
   in-chat-process wiring of the respond deps is architecturally impossible without a
   cross-process bridge. See §7 for the deferral design.
3. **Quorum bypass in the fork.** The fork calls `approveLifecycle` unconditionally. The
   legacy leg (`platform-lifecycle.ts:129`) executes only when
   `transitionApproval(...).status === "approved"`. A 1-of-2 quorum approve through the
   fork transitions the LIFECYCLE to approved (and materializes) while the legacy row is
   still pending: quorum is bypassed on the lifecycle path.
4. **Patch dead-end in the fork.** Fork patch sets the legacy row to terminal `"patched"`
   (`transitionApproval` rejects any later approve on a non-pending row) and creates a new
   lifecycle revision, but never dispatches. The legacy surface contract is
   patch-responds-AND-executes (`platform-lifecycle.ts:189-232`: patch -> trace update ->
   `executeAfterApproval`, ledger `action.patched`). The fork's patch leaves the unit
   unreachable through the legacy-id surface.
5. **Telegram approve buttons are undeliverable (different seam, flagged not fixed).**
   `TelegramApprovalNotifier.buildButtons` puts the full JSON payload (~160 bytes) into
   `callback_data`, whose Telegram limit is 64 bytes; sendMessage rejects with
   BUTTON_DATA_INVALID. WhatsApp button ids (256) and Slack action values (2000) fit. The
   respond seam fixed here is exercised today by WhatsApp and Slack; the Telegram
   outbound defect needs a short-token design in the notifier (follow-up, §8).

## 2. Decision 1: unification shape. CHOSEN: extract the shared dispatch engine

**Options considered**

- A. `respondViaLifecycle` delegates approve/reject to `respondToParkedLifecycle`, with
  the legacy-row state machine updated around it.
- **B. Extract the dispatch leg (frozen-payload trace write + dispatch + recovery) into a
  module both forks call** (chosen).
- C. Retire the fork; route `respondToApproval`'s lifecycle case through
  `respondToParkedLifecycle`, keeping the legacy approval row as a side record.

**Why B:** the invariant lives in the approve-to-dispatch chain, not in the surrounding
state machines. A and C must wedge legacy concerns (envelope flip to "approved" BEFORE
dispatch, which `executeAfterApproval` gates on; quorum partial-approve; patch semantics;
legacy-row optimistic versioning) INTO `respondToParkedLifecycle` between its approve and
dispatch steps, polluting the clean lifecycle-native contract that #874 shipped and its
13-case suite pins. B moves the invariant-bearing code into one place, leaves
`respondToParkedLifecycle` behaviorally untouched (its suite passing unchanged proves the
refactor), and lets the legacy fork keep its legacy concerns.

### 2.1 New module: `packages/core/src/approval/lifecycle-dispatch.ts`

Moved verbatim from `respond-to-parked-lifecycle.ts` (which now imports them):

```
writeApprovedPayloadToTrace(deps, lifecycle, executableWorkUnit, respondedBy,
                            respondedAt, caller)
  // spec 4.1: frozenPayload.parameters + approvalOutcome/RespondedBy/At onto the
  // WorkTrace BEFORE dispatch; throws if the trace store rejects the update.
runDispatch(deps, lifecycle, executableWorkUnitId, revisionId): Promise<ExecuteResult>
  // attemptNumber = countDispatchAttempts + 1; prepareDispatch with deterministic key
  // lifecycle-dispatch:<lc>:<rev>:attempt-<n>; executeApproved; recordDispatchOutcome;
  // throw OR success:false -> markRecoveryRequired.
markRecoveryRequired(deps, lifecycleId)
  // approved -> recovery_required, version-checked, log-on-failure.
```

Deps type is the shared subset: `{ lifecycleService, workTraceStore, platformLifecycle:
ExecuteApprovedLike, logger }`. No export surface change for consumers; the module is
internal to core/approval (exported types only as needed by the two callers).

### 2.2 The unified `respondViaLifecycle` approve leg (lifecycle-authority order)

```
1. four-eyes guard (existing assertNotSelfApproval, unchanged)
2. newState = transitionApproval(state, action, ...)   // PURE compute; throws on
   non-pending = the already-responded guard
3. QUORUM short-circuit: if approval.state.quorum and newState.status !== "approved":
   approvalStore.updateState(newState) and return
   { approvalState: newState, executionResult: null }  // partial approval recorded;
   lifecycle untouched. Fixes §1.3.
4. approveLifecycle(lifecycleId, respondedBy, clientBindingHash, workUnit, ...)
   // THE authority commit: optimistic-locked, binding-hash-checked against the
   // CURRENT revision. Failure here mutates nothing else.
5. writeApprovedPayloadToTrace(...)                     // 4.1 payload authority
6. envelopeStore.update(envelopeId, { status: "approved" })
   // executeAfterApproval throws unless the envelope (when one exists) is approved;
   // must precede dispatch.
7. approvalStore.updateState(approvalId, newState, version)  // legacy row = SIDE
   // RECORD now: best-effort AFTER the authority commit. On failure: log the skew
   // and continue. Once the lifecycle is approved, nothing may stand between it and
   // dispatch-or-recovery; aborting here would recreate the bare-approve hole.
8. executionResult = runDispatch(...)                   // shared engine; failure ->
   // recovery_required (Inbox Retry card)
9. ledger action.approved (auditLedger, when provided)
return { envelope, approvalState: newState, executionResult }  // ExecuteResult
```

Ordering rationale: today's fork does `updateState` FIRST, so a legacy-row version race
aborts before lifecycle mutation; that was safe only because nothing dispatched. With
dispatch in the chain, the lifecycle commit is the point of no return, and every
post-commit step must fail TOWARD dispatch-or-recovery, not away from it. All responders
to a lifecycle-backed unit route through this fork, so the legacy row's only concurrent
writers (a raced second responder) die at step 4's optimistic lock; step 7 failures are
logged skew on a deprecated side record, not correctness.

`executionResult` becomes the real `ExecuteResult` (was `{ executableWorkUnitId }`),
aligning the legacy-id leg with the lifecycle-native leg of the route (`{ envelope,
approvalState, executionResult }` with `executionResult.success` keeping its meaning:
200 + success:false = approved, dispatch failed, Retry card now exists). No non-test
consumer reads `executionResult.executableWorkUnitId` (verified by grep; the route
passes the object through and the gateway ignores it today).

### 2.3 Patch leg: patch responds AND executes (matches the legacy surface contract)

```
1. four-eyes guard (patch advances toward execution; already covered)
2. newState = transitionApproval(state, "patch", ...)   // pure; non-pending throws
3. revision = createRevision(patched params, new bindingHash,
                             sourceBindingHash = client bindingHash)
   // source-hash-checked against the current revision: a stale patch dies here
4. approveLifecycle(clientBindingHash = revision.bindingHash)  // approve the NEW
   // revision; the materializer freezes revision.parametersSnapshot = patched params
5-9. identical to 2.2 steps 5-9 (frozen payload IS the patched payload; ledger event
     action.patched)
```

This heals §1.4: the previous fork behavior (park a new revision, terminal-patch the
legacy row, dispatch nothing) left the unit unreachable through the legacy id. The legacy
non-lifecycle leg has always treated patch as approve-with-modifications and executed
immediately; the lifecycle fork now keeps that promise with revision-grade payload
authority. A dedicated test pins the invariant on this path: trace parameters
`{ campaignId: "old" }`, patch `{ campaignId: "patched" }` -> the mode handler receives
`"patched"`, never `"old"`. Chat cannot send patch (`parseApprovalResponsePayload`
allows approve|reject only); the parked leg continues to 400 `patch_unsupported`.

### 2.4 Reject leg: unchanged

`updateState -> rejectLifecycle -> envelope denied` keeps its current order. No dispatch
is at stake on reject; a raced reject dies at the legacy-row optimistic lock with the
lifecycle still pending, which is safe and retryable. Minimal diff wins.

### 2.5 New optional dep: `auditLedger`

`RespondToApprovalDeps` gains `auditLedger?: AuditLedger`. The unified approve/patch legs
no longer pass through `platformLifecycle.respondToApproval` (which wrote its own ledger
events), so the fork records `action.approved` / `action.patched` itself when the ledger
is provided. `apps/api/src/routes/approvals.ts` passes `app.auditLedger`; the chat
fallback (§4) passes it through `respondDeps`. `executeAfterApproval` keeps writing the
`action.queued|executed|failed` events internally, unchanged.

## 3. Decision 2: chat recovery UX. CHOSEN: honest replies; retry only where it is free

**Options considered**

- I. Honest replies only; recovery always points at the Inbox Retry card.
- **II. Honest replies + retry through the lifecycle fallback leg only** (chosen).
- III. Proactive chat notification on dispatch failure. EXCLUDED by the slice mandate
  (no parallel notification system).

**Why II:** approve-on-`recovery_required` IS the retry leg inside
`respondToParkedLifecycle`, so the §4 fallback gives chat retry for lifecycle-native ids
with zero extra machinery. For legacy-row buttons the pre-check (`state.status !==
"pending"` -> already-handled) keeps blocking re-taps; teaching that pre-check recovery
semantics would change a deliberate anti-confusion guard for a marginal flow whose
canonical recovery surface (the Inbox Retry card, urgency 100) shipped last slice.
Smallest honest slice.

Reply copy (constants in `handle-approval-response.ts`; terse by design, the dashboard
remains the detail surface; no deep-link URLs, core has no canonical dashboard URL dep):

| situation                                                | reply                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| approve, dispatch success (completed or queued, #860)    | "Approved. The action has run or is queued to run."                                                                 |
| approve, dispatch failed (throw or success:false)        | "Approved, but the action did not run. It is waiting in your inbox as a Retry card. Approving it there retries it." |
| approve recorded, quorum still open                      | "Your approval is recorded. More approvals are required before it runs."                                            |
| reject                                                   | "Rejected." (existing)                                                                                              |
| retry via fallback leg succeeds / fails                  | same two approve replies above                                                                                      |
| self-approval refused                                    | "You cannot approve an action you initiated. Another operator must respond."                                        |
| stale binding (approveLifecycle/createRevision refusal)  | existing STALE_MSG                                                                                                  |
| already responded / expired / not found / not authorized | existing messages                                                                                                   |

The success reply does not distinguish completed from queued: `ExecuteResult` does not
carry the outcome enum (only `success`, which #860 maps from completed-or-queued), and
widening that schema for reply copy is not worth it. The wording is honest for both.

Mapping happens in the gateway from the unified result: `executionResult === null` +
quorum-open approvalState -> partial; `executionResult.success` true/false -> the two
approve replies; thrown errors map by class/message: `StaleVersionError` and
lifecycle-status-mismatch -> ALREADY_RESPONDED (existing), `/stale binding/i` ->
STALE_MSG (new; today a post-patch button tap lands in the generic execution-error
reply, which is wrong), `/self-approval/i` -> the new self-approval reply,
`ParkedLifecycleNotFoundError/AlreadyResponded/Expired` (fallback leg) -> their existing
counterparts, everything else -> APPROVAL_EXECUTION_ERROR_MSG (existing).

## 4. Decision 3: durability of the chat approval handle. CHOSEN: lifecycle fallback

**Options considered**

- **A. Tolerate a missing approval row by falling through to the lifecycle** (mirror the
  #877 route fallback) (chosen).
- B. Durable-ize the legacy approval-row store. ALREADY SHIPPED on main (§1.1): prod rows
  are Prisma-backed and cross-process readable (the chat gateway-bridge already reads
  `PrismaApprovalStore`). No work remains in this option beyond dev-no-DB, which is not
  worth a slice.

`handleApprovalResponse` on `approvalStore.getById` miss (or null), BEFORE replying
NOT_FOUND: when `respondDeps.lifecycleService` is wired, try
`getLifecycleById(payload.approvalId)`. When found:

1. org check: `lifecycle.organizationId === organizationId` else NOT_FOUND (no
   existence leak, mirrors the legacy-row org check).
2. binding-hash pre-check: timing-safe compare of `payload.bindingHash` against
   `getCurrentRevision(lifecycle.id).bindingHash` (the CURRENT revision, so a patched
   unit refuses the old button with STALE_MSG; `approveLifecycle` re-validates as the
   authority).
3. binding + role auth: unchanged (active `OperatorChannelBinding` -> Principal with an
   approver role; fail closed without config).
4. `respondToParkedLifecycle(deps', { lifecycleId, action, respondedBy:
binding.principalId, bindingHash })` where deps' is the shared subset of
   `respondDeps` + `auditLedger`. Approve on `recovery_required` is retry, for free.
5. Reply mapping per §3.

This serves: dev/restart loss of in-memory rows; future lifecycle-native chat
notifications (buttons carrying lifecycle ids); chat retry. Reject through the fallback
needs no bindingHash (matches the parked leg contract; the pre-check in step 2 applies to
approve only, mirroring the route).

## 5. Tests (co-located, TDD; db/api tests use mocked Prisma; core uses

`InMemoryLifecycleStore`)

- **core/approval, fork unit suite** (extends
  `respond-to-approval-self-approval.test.ts` into a full
  `respond-to-approval-lifecycle-fork.test.ts` with REAL `ApprovalLifecycleService` over
  `InMemoryLifecycleStore` and a spy `executeApproved`):
  - approve drives approveLifecycle -> frozen payload on trace -> envelope approved ->
    legacy row approved -> DispatchRecord succeeded -> executionResult is the
    ExecuteResult (NOT executableWorkUnitId).
  - payload authority: stale trace params vs revision snapshot; handler sees snapshot.
  - patch-then-execute: patched revision created; handler receives PATCHED params;
    legacy row terminal "patched"; ledger action.patched. (The patch-path payload
    authority test the slice demands.)
  - dispatch throw AND success:false -> recovery_required + failed DispatchRecord; the
    respond call still returns/throws honestly.
  - quorum 1-of-2: legacy row records partial; lifecycle UNTOUCHED (no approveLifecycle
    call); executionResult null.
  - legacy-row updateState failure after approve: dispatch still runs (log skew).
  - stale binding mutates nothing (legacy row still pending).
  - existing self-approval trio keeps passing unchanged.
- **core/approval, extraction proof**: the 13-case `respond-to-parked-lifecycle.test.ts`
  passes UNCHANGED (no edits to the file in PR-1).
- **core/channel-gateway**: rebuild the respond fixtures around a REAL
  `ApprovalLifecycleService` + real `respondToApproval` deps with a spy
  `executeApproved` asserting THE HANDLER RAN (not just status === approved):
  - approve (legacy row + lifecycle) -> dispatch ran -> success reply.
  - approve with sabotaged dispatch -> recovery_required -> the honest failed reply.
  - fallback leg: no approval row, lifecycle id -> approve runs respondToParkedLifecycle
    -> dispatch ran -> success reply; retry on recovery_required -> attempt 2; org
    mismatch -> NOT_FOUND; current-revision hash mismatch -> STALE; reject without
    bindingHash works.
  - stale-binding error -> STALE_MSG; self-approval -> its reply; quorum-partial -> its
    reply. Existing 18 cases keep passing (mock-deps cases migrate mechanically).
- **integration (PR-3, extends the #879 harness + `buildLifecycleWorld` pattern)**: cron
  parks the handoff -> a legacy ApprovalRequest row is seeded for the same work unit id
  (the legacy+lifecycle coexistence shape) -> the CHAT entry (`handleApprovalResponse`
  with binding store, identity store, real respondDeps) approves -> REAL
  ApprovalLifecycleService + REAL PlatformLifecycle + REAL ExecutionModeRegistry -> the
  REAL handoff handler runs -> Mira CreativeJob exists via the real read model -> trace
  completed, lifecycle approved, DispatchRecord succeeded, reply is the success message.
  Failure leg: `breakHandoffHandlerOnce` -> reply is the honest failure message ->
  lifecycle recovery_required -> retry via the parked leg (Inbox semantics) recovers ->
  job exists, attempt 2 succeeded. Fallback leg: chat approve with the LIFECYCLE id and
  no approval row -> same guarantees. Mutation checks (each verified RED once): skip the
  dispatch call -> the handler-ran assertion fails; break the frozen-payload write ->
  payload-authority assertion fails; sabotage without recovery transition -> the
  recovery_required assertion fails.

## 6. Delivery: three implementation PRs after this spec lands

Sequential, file-disjoint between PRs, no remote stacking:

1. **PR-1 core+api respond unification**: `lifecycle-dispatch.ts`,
   `respond-to-parked-lifecycle.ts` (imports only), `respond-to-approval.ts` (unified
   fork + auditLedger dep), `routes/approvals.ts` (pass auditLedger), fork unit suite.
2. **PR-2 chat gateway**: `handle-approval-response.ts` (fallback leg + reply mapping +
   new constants), gateway test rebuild. (`types.ts` only if a type widening is
   unavoidable; respondDeps already carries everything.)
3. **PR-3 integration proof**: the chat-approval-loop test in `apps/api/src/__tests__/`
   (+ minimal harness export additions only if needed).

## 7. Deferred: production wiring of the chat process (named follow-up, not this slice)

The chat process cannot dispatch (no execution runtime; §1.2). The correct production
shape is a thin internal respond bridge: chat forwards
`{ approvalId, action, bindingHash, channel, channelIdentifier, organizationId }` to the
API over the existing `INTERNAL_API_SECRET` trust channel (precedent:
`notify-chat-provisioned-channel.ts`), and the API re-derives the operator principal
SERVER-SIDE from its own `OperatorChannelBindingStore` lookup + role check, then calls
the same unified engine. Chat attests only the webhook-authenticated transport identity;
`respondedBy` never crosses a process boundary as a claim. This is auth-bearing surface
(new route, secret handling, replay considerations) and is deliberately its own slice.
Until it ships, production chat approvals keep failing closed exactly as today
(NOT_AUTHORIZED); this slice makes the engine and the gateway correct, honest, and
proven so that wiring becomes configuration, not surgery.

## 8. Risks and honest limits

- **Chat remains unwired in production after this slice** (§7). The engine fix IS live
  for the API surface on merge: any legacy+lifecycle approval responded via
  `POST /api/approvals/:id/respond` dispatches (or surfaces recovery) instead of
  silently parking.
- **Telegram outbound buttons** stay undeliverable until the notifier short-token
  follow-up (§1.5); WhatsApp and Slack payloads fit today.
- **Pre-fix zombies**: units approved through the old fork (lifecycle approved, never
  dispatched, no recovery_required) are invisible to the feed and unrecoverable through
  any respond surface. An ops backfill (approved + no DispatchRecord ->
  recovery_required) would surface them as Retry cards; out of scope here.
- **Approved-then-trace-locked**: if the frozen-payload trace write is rejected after
  `approveLifecycle`, the respond throws with the lifecycle approved but undispatched
  and not in recovery (pre-existing #874 behavior, now shared). The integrity-lock
  audit + operator alert inside the trace store is the operator-facing record.
- **Quorum races** keep today's semantics (optimistic-lock loser gets
  already-responded); quorum is a policy-gated edge flow.
- The legacy approval row becomes formally a side record on lifecycle-backed units;
  post-authority sync failures are logged skew, not aborts (§2.2 step 7 rationale).
- `GET /api/approvals/pending` stays deprecated-in-place, untouched.
