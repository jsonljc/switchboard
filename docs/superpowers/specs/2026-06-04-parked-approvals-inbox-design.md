# Parked governed-workflow approvals: operable from the operator Inbox

Date: 2026-06-04 (v2, revised after design review)
Status: approved (autonomous slice, post-#861)
Proving case: Riley -> Mira handoff (`adoptimizer.recommendation.handoff`, PR #861)

Governing invariant (from review): **the Inbox is only the surface. The product is the
invariant that a human approves exactly one frozen action, and the system either executes
that exact action or exposes the failed execution for recovery.**

## 1. Problem

A governed workflow intent that parks for mandatory human approval is a dead end for the
operator. As of `055a2100` the gap is four-fold, verified against source:

1. **Invisible in the Inbox.** The decision feed (`apps/api/src/routes/decisions.ts`) reads
   only `recommendationStore` + `handoffStore`. Parked WorkUnits exist as a WorkTrace
   (`outcome: "pending_approval"`) plus an `ApprovalLifecycle` row created inside
   `PlatformIngress.submit()` (`platform-ingress.ts:294`). Neither store sees them.
2. **Invisible in the legacy pending list.** `GET /api/approvals/pending` reads
   `storageContext.approvals`, which is the **in-memory** `InMemoryApprovalStore` even in
   production (`core/src/storage/index.ts:37`). Internally-triggered parked units (cron,
   schedule, internal) never create an ApprovalRequest row at all: `createApprovalForWorkUnit`
   is only called from the HTTP routes' legacy fallback, and only when `lifecycleService` is
   NOT wired (`routes/actions.ts:98-136`).
3. **Not respondable.** When `lifecycleService` IS wired (production), `routes/actions.ts`
   returns `approvalRequest.id = lifecycleId` to clients, but `POST /api/approvals/:id/respond`
   does `storageContext.approvals.getById(id)` and 404s. The respond contract that propose
   promises is broken for every lifecycle-parked unit.
4. **No post-approval dispatch on the lifecycle fork.** `respondToApproval`'s lifecycle leg
   (`core/src/approval/respond-to-approval.ts:283-316`) materializes an ExecutableWorkUnit and
   returns; nothing dispatches it. Only the legacy fork reaches
   `platformLifecycle.executeAfterApproval` (the real `modeRegistry.dispatch`). The #861
   full-loop test hand-drives `modeRegistry.dispatch` for exactly this reason.

The fix must be general for every parked intent (`adoptimizer.recommendation.handoff`,
`creative.job.publish`, `conversation.reminder.send`, `conversation.followup.send`, plus any
cartridge-mode parked action), with the handoff as the proving case.

Stale-brief notes (re-verified): `apps/dashboard/src/components/cockpit/approval-card.tsx`
does not exist on main; the `/api/dashboard/approvals` proxy + `respondToApproval` client
method exist but have **no UI consumer** (orphaned plumbing from the gov-UX strip).

## 2. Sub-problem 1: surfacing. CHOSEN: bridge into the Decision feed

**Options considered**

- **A. Bridge parked lifecycles into the existing decision read model** (chosen).
- B. Build a new unified approvals surface (page or section) over a migrated
  `/api/approvals/pending`.
- C. Revive the legacy pending list and wire the dashboard to it.

**Why A:** the Inbox is the operator's primary surface (P1-C); the `Decision` model already
carries `humanSummary`, presentation labels, urgency, and the five-field risk contract the
swipe/confirm UX keys on; `core/src/decisions/adapters/` is the established per-kind adapter
pattern. B creates a second place to check for the same job. C's surface has no consumer and
its store is in-memory (empty for every parked governed unit in production); its own comment
says "will migrate to lifecycleService.listPendingLifecycles()".

**Mechanism:** `listDecisions()` in `routes/decisions.ts` gains a third leg, guarded on
`app.lifecycleService && app.workTraceStore` (absent in dev-no-DB, route degrades to current
behavior):

```
lifecycleService.listOperatorActionableLifecycles(orgId)
  // = pending (expiry-filtered) UNION recovery_required (approved but dispatch failed)
  -> SORT by expiresAt ascending (most urgent first)   // sort BEFORE cap
  -> cap 25; log truncation WITH hidden count
  -> per lifecycle: workTraceStore.getByWorkUnitId(lc.actionEnvelopeId)   // intent, params, actor
                    lifecycleService.getCurrentRevision(lc.id)            // bindingHash
  -> adaptParkedApproval(lifecycle, revision, trace, summarizer)          // core adapter
  -> trace or revision MISSING: adaptDegradedParkedApproval(lifecycle)    // never silently skip
```

New `DecisionKind`: `"workflow_approval"`. Counts: workflow approvals are added to
`counts.approval` and `counts.total` (wire shape unchanged, no new count key).

**Degraded card (review #5):** a lifecycle whose trace or revision cannot be loaded still
renders: "An approval could not be fully loaded (id <first 8 chars>). You can still reject
it; approving needs the underlying work record." with lifecycle id, created, expiry as data
lines, unknown-high risk contract, and an `app.log.error` (ops-grepable, includes
lifecycleId). Mandatory governed work must never silently vanish from the operator surface.

## 3. Sub-problem 2: humanization. CHOSEN: core adapter + apps/api summarizer registry

**Options considered**

- **H1. Generic adapter in core; per-intent summarizer registry in apps/api** (chosen).
- H2. An operator-card hook on `IntentRegistration` (core platform type).
- H3. Inline in the approval read model (route code).

**Why H1:** the parameter shapes are owned by the workflow modules in apps/api (layer 5);
core (layer 3) must stay surface-agnostic and cannot import them. H2 would put a presentation
concern on the governance registration type and require exposing the intent registry to
routes. H3 is an untestable route lump. H1 mirrors how `adaptHandoff`/`adaptRecommendation`
already work: core owns the Decision contract, the caller supplies domain knowledge.

**Core** (`packages/core/src/decisions/adapters/parked-approval-adapter.ts`):

```ts
export interface ParkedApprovalSummary {
  humanSummary: string;
  dataLines?: ReadonlyArray<string | string[]>;
  presentation?: Partial<DecisionPresentation>;
  riskContract?: RiskContract;
  contactName?: string;
}
export type ParkedApprovalSummarizer = (ctx: {
  intent: string;
  parameters: Record<string, unknown>;
  actorId: string;
  organizationId: string;
}) => ParkedApprovalSummary | null; // null -> fall through to the default card

export function adaptParkedApproval(
  lifecycle: { id; status; expiresAt; createdAt; organizationId },
  revision: { bindingHash },
  trace: WorkTrace,
  summarizer?: ParkedApprovalSummarizer,
): Decision;
export function adaptDegradedParkedApproval(lifecycle): Decision;
```

- `Decision.id = "workflow_approval:" + lifecycle.id`; `sourceRef = { kind: "workflow_approval",
sourceId: lifecycle.id }`; `meta.bindingHash = revision.bindingHash` (the approve key);
  `meta.slaDeadlineAt = lifecycle.expiresAt` (deadline semantics).
- **Default card is rich, not thin (review #10):** humanSummary
  `"<Agent> needs your approval to run <intent>."` plus data lines for intent, actor,
  trigger, created, expiry, AND a compact parameter preview (up to 4 top-level keys,
  primitives only, values redacted when the key matches
  `/token|secret|key|password|phone|email|credential/i`, strings truncated at 60 chars),
  plus the line "No bespoke summary for this action type yet."
- **Default risk contract fails CLOSED toward caution (review #2):** unknown parked intents
  default to `{ riskLevel: "high", externalEffect: true, financialEffect: false,
clientFacing: true, requiresConfirmation: true }`. Unknown governed work may be
  client-facing or external; under-warning is the wrong failure mode. Bespoke summarizers
  override with accurate contracts.
- **Recovery cards (review #3):** when `lifecycle.status === "recovery_required"`, the card
  prefixes "Approved, but it didn't run: " onto the summary, sets
  `presentation.primaryLabel = "Retry"`, `meta.dispatchFailed = true`, and urgency 100
  (approved-but-unexecuted governed work outranks everything).
- Agent attribution: `resolveAgentKey(trace.deploymentContext?.skillSlug)`; extend the map
  with `"creative" -> mira` and `"digital-ads" -> riley` (today both default to alex, which
  would misattribute publish and ads cards).
- Urgency: new `scoreParkedApproval` in `urgency.ts`: risk floor (low 45 / medium 55 /
  high 70) and a ramp toward 100 as `expiresAt` nears (<24h).

**apps/api** (`apps/api/src/services/workflows/parked-approval-cards.ts`): a
`Record<string, ParkedApprovalSummarizer>` co-located with the workflow modules that own the
shapes. Shipped now:

- `adoptimizer.recommendation.handoff`: "Riley wants to brief Mira to refresh creative on
  campaign <campaignId>: <rationale>"; dataLines for evidence (clicks / conversions / days
  window), the brief (productDescription, targetAudience), and learning-phase state;
  presentation `{ primaryLabel: "Approve handoff" }`; risk medium, requiresConfirmation true,
  financialEffect false (the handoff itself only creates a draft; spend is gated later).
- `creative.job.publish`: "Mira wants to publish creative <jobId> to Meta as a paused draft
  package. It will not spend until you activate it in Meta." Parameters-only (jobId is all
  the WorkUnit carries). Risk (review #9): `{ riskLevel: "high", externalEffect: true,
financialEffect: false, clientFacing: false, requiresConfirmation: true }`: a paused
  draft creates a Meta-side object (external) but cannot spend (not financial) and is not
  shown to clients.

`conversation.reminder.send` / `conversation.followup.send` ship the **default card** in this
slice (deferred bespoke copy: they are `approvalPolicy: "none"` and only park under bespoke
org threshold policies; the default card is truthful and, post-review, conservative).
Unknown/future intents get the default card by construction.

## 4. Sub-problem 3: action. CHOSEN: lifecycle-native respond leg in core, same route

**Options considered**

- **R1. Extend `POST /api/approvals/:id/respond` with a lifecycle-native fallback; the logic
  lives in core** (chosen).
- R2. A new bespoke route (`POST /api/workflow-approvals/:lifecycleId/respond`).
- R3. Route the operator response through `PlatformIngress.submit()` as an operator intent.

**Why R1:** `routes/actions.ts` already returns `lifecycleId` as `approvalRequest.id`, so the
existing contract promises exactly this and today 404s; extending the route heals it for every
client. R2 duplicates surface for the same lifecycle transition. R3 contradicts the deliberate
route-class split (#654): approval response is a lifecycle transition on an already-addressed
work unit, not new operator-direct ingress; "approval is lifecycle state" is the invariant.

### 4.1 Payload authority (review #1: the load-bearing invariant)

`approveLifecycle` validates `clientBindingHash` against the CURRENT REVISION and freezes
`revision.parametersSnapshot` into `ExecutableWorkUnit.frozenPayload` (see
`buildMaterializationInput`). But `executeAfterApproval` dispatches from the **WorkTrace**.
If trace parameters ever diverge from the approved revision, the operator approves one
payload and the system executes another: the binding hash becomes theater.

**Rule: the dispatched payload IS the frozen payload.** After `approveLifecycle` returns,
`respondToParkedLifecycle` writes `executableWorkUnit.frozenPayload.parameters` onto the
WorkTrace (`traceStore.update(..., { parameters: frozenPayload.parameters, ... })`) BEFORE
calling `executeApproved`. This follows the established legacy-patch precedent
(`updateWorkTraceApproval` writes patched parameters to the trace, then
`executeAfterApproval` reads them): WorkTrace is canonical persistence; approval commits the
approved parameters to it. A mutation test seeds `trace.parameters = { campaignId: "old" }`
vs `revision.parametersSnapshot = { campaignId: "approved" }` and asserts the mode handler
receives `"approved"`, never `"old"`.

### 4.2 `executeApproved` contract, frozen (review #4)

- `platformLifecycle.executeApproved(workUnitId)` takes the ORIGINAL WorkUnit id
  (`lifecycle.actionEnvelopeId` === `trace.workUnitId`). It loads the WorkTrace and
  dispatches `trace.mode / trace.intent / trace.parameters`, then updates the trace outcome
  and writes the `action.queued|executed|failed` ledger events (including the #860
  queued-is-success mapping).
- The `DispatchRecord` is keyed by `ExecutableWorkUnit.id` (the dispatch authority object)
  with a DETERMINISTIC idempotency key
  `lifecycle-dispatch:<lifecycleId>:<revisionId>:attempt-<n>`: unique key = the
  double-dispatch lock per attempt.
- The bridge that makes the two consistent is 4.1: by the time `executeApproved` runs, the
  trace carries the frozen payload, so "dispatch from trace" and "dispatch the approved
  payload" are the same thing. This contract is documented in the module docstring and
  pinned by the 4.1 mutation test.

### 4.3 The respond module

**Core** (`packages/core/src/approval/respond-to-parked-lifecycle.ts`), the single point where
a lifecycle-native response enters (mirrors respond-to-approval.ts's charter):

```
respondToParkedLifecycle(deps, params)
  deps:   lifecycleService, workTraceStore, platformLifecycle ({ executeApproved }),
          auditLedger?, logger, selfApprovalAllowed?
  params: lifecycleId, action: "approve" | "reject", respondedBy, bindingHash?, note?
```

- Lookup by lifecycleId. Branch on status:
  - `pending` -> normal approve/reject (expired `pending` responds are refused after marking
    the lifecycle expired via `expireLifecycle`).
  - `recovery_required` -> RETRY leg (approve action only; see 4.4).
  - anything else -> `ParkedLifecycleAlreadyRespondedError` (409, `code: "already_responded"`).
- Trace is REQUIRED for approve/retry (no envelope fallback). Reject tolerates a missing
  trace (mirrors `rejectLifecycle`'s own tolerance) so a degraded card can still be rejected.
- Four-eyes: `trace.actor.id === respondedBy` throws unless `selfApprovalAllowed`
  (cron units carry the seeded `system` actor, so any operator passes). `respondedBy` is
  server-derived (see 4.5) so this compares against a trusted principal.
- **Reject** -> `lifecycleService.rejectLifecycle` (existing: integrity admission before
  mutation, trace `outcome: failed` + `approvalOutcome: rejected`), then ledger
  `action.rejected`.
- **Approve** -> `approveLifecycle` (optimistic-locked approve + materialize; validates
  `clientBindingHash` against the current revision) -> write trace: frozen payload
  parameters (4.1) + approval fields (`approvalOutcome: approved`, respondedBy/At) ->
  `prepareDispatch` (admission: lifecycle approved, executable current + unexpired; creates
  the DispatchRecord with the attempt-keyed idempotency key) -> `executeApproved` ->
  `recordDispatchOutcome` -> ledger `action.approved` (snapshot carries the operator note).

### 4.4 Dispatch-failure recovery (review #3)

Approval must never make work vanish. When `executeApproved` THROWS, or returns
`success: false`:

1. `recordDispatchOutcome(state: "failed", errorMessage)`: durable evidence on the
   DispatchRecord.
2. The lifecycle transitions `approved -> "recovery_required"` (version-checked). The status
   value already exists in the schema for exactly this.
3. The feed lists `recovery_required` lifecycles alongside pending ones; the card reads
   "Approved, but it didn't run: <summary>" with primary action **Retry** and urgency 100.
4. **Retry** is the same respond endpoint with `action: "approve"`: on a `recovery_required`
   lifecycle the module skips `approveLifecycle` (already approved; bindingHash is still
   validated against the current revision as defense), transitions
   `recovery_required -> approved` (so dispatch admission stays strict: only `approved`
   dispatches), computes `attemptNumber = countDispatchAttempts(executableWorkUnitId) + 1`,
   and re-runs the dispatch leg. Failure transitions back to `recovery_required`.
5. Concurrency: two racing retries read the same lifecycle version; one loses the
   version-checked transition (StaleVersionError -> 409). The attempt-keyed unique
   idempotency key is the second lock.

Known limit (stated): there is no "abandon a failed dispatch" action in v1: a permanently
failing dispatch keeps its Retry card (which is the honest state: approved governed work that
has not executed). Follow-up if it bites.

Store additions for this: `ApprovalLifecycleStore.listRecoveryRequiredLifecycles(orgId?)` and
`countDispatchRecords(executableWorkUnitId)` (implemented in `PrismaLifecycleStore` +
`InMemoryLifecycleStore`); `prepareDispatch` gains an optional `attemptNumber` (default 1);
service passthroughs `getLifecycleById`, `getCurrentRevision`, `countDispatchAttempts`,
`listOperatorActionableLifecycles`.

### 4.5 Identity: `respondedBy` is never client-trusted (review #7)

- When `request.principalIdFromAuth` is set (every production request), it IS the responder.
  A body `respondedBy` that differs is a 403 (explicit, not silently ignored); a matching one
  is redundant. The dashboard sends none.
- When auth is disabled (`app.authDisabled === true`, dev/test only), body `respondedBy`
  (default `"default"`) is accepted.
- Auth enabled but no principal binding -> 403 (fail closed; never respond as "unknown").
- Self-approval compares the trace actor against this server-derived principal.

### 4.6 Route + structured errors (review #11)

`apps/api/src/routes/approvals.ts`: on `approvals.getById(id)` miss AND `app.lifecycleService`
present, fall through to the lifecycle-native leg: org access via
`assertOrgAccess(request, lifecycle.organizationId)`; patch -> 400 (`code:
"patch_unsupported"`); missing bindingHash on approve -> 400. Error mapping is STRUCTURED ,
every non-2xx body carries `{ error, code, statusCode }`:

| condition                                                | status | code                |
| -------------------------------------------------------- | ------ | ------------------- |
| unknown id (no approval row, no lifecycle)               | 404    | `not_found`         |
| already responded (status not pending/recovery_required) | 409    | `already_responded` |
| expired                                                  | 409    | `expired`           |
| stale binding hash                                       | 400    | `stale_binding`     |
| dispatch admission failure                               | 409    | `admission_failed`  |
| concurrent retry lost the version race                   | 409    | `conflict`          |
| self-approval                                            | 400    | `self_approval`     |
| patch on lifecycle leg                                   | 400    | `patch_unsupported` |

Response shape on success matches the legacy leg: `{ envelope: null, approvalState,
executionResult }` where `executionResult` is the `ExecuteResult` from `executeApproved`
(`executionResult.success` keeps meaning; a 200 with `success: false` means "approved,
dispatch failed, the card is now a Retry card").

`GET /api/approvals/pending` is marked DEPRECATED in code (route comment + OpenAPI
description) but otherwise untouched; the decisions feed is the read surface (review #8).

## 5. Dashboard

- `lib/decisions/types.ts`: `DecisionKind` + `"workflow_approval"`; `meta.bindingHash?:
string`; `meta.dispatchFailed?: boolean`.
- `InboxScreen` map branches by kind: `workflow_approval` renders `InboxWorkflowApprovalItem`
  (new wrapper owning no hooks), reusing `InboxDecisionCard` with `onApprove`/`onSkip` both
  routed to `onOpenDetail`: NO gesture ever commits for this kind (the conservative risk
  contract already blocks swipe-approve; routing is defense in depth, and swipe-left must
  not fire the recommendation responder with a lifecycle id).
- Detail sheet: reuse `ApprovalDetailSheet` (fully presentation-driven). A
  `WorkflowApprovalDetailItem` wrapper maps `onCommit -> approve` (confirm flow + note),
  `onSecondary -> close` ("Not now"), `onDismiss -> reject`.
- **bindingHash is REQUIRED to approve (review):** the wrapper refuses to fire approve when
  `meta.bindingHash` is absent (toast: "This approval can't be approved from here yet")
  instead of sending a doomed request.
- `useWorkflowApprovalAction`: POST `/api/dashboard/approvals` (existing proxy) with
  `{ approvalId: lifecycleId, action, bindingHash, note? }` and NO respondedBy. Structured
  error handling (review #11): silent-success ONLY for `code already_responded | expired`
  (both mean "someone else settled it"; refetch clears the card); `stale_binding` surfaces
  "This approval changed. Refreshing." + feed invalidation; everything else surfaces its
  message. Invalidate decisions + audit keys on settle.

## 6. Tests (every seam; mocked Prisma, CI has no Postgres)

- **core / adapter**: default card (rich data lines, parameter preview with redaction);
  summarizer override; null-summarizer fallthrough; agent attribution; urgency ramp;
  bindingHash + sourceRef; **unknown-intent default risk is high/external/client-facing
  (review 14C)**; recovery card (Retry label, urgency 100, dispatchFailed meta); degraded
  card.
- **core / respond**: with `InMemoryLifecycleStore`: approve drives trace approval fields +
  DispatchRecord + executeApproved; **revision-authority mutation test (review 14A): trace
  params "old" vs approved snapshot "approved" -> trace carries "approved" at dispatch
  time**; reject; reject-with-missing-trace; stale hash mutates nothing; already-responded;
  expired; self-approval; unknown id; **dispatch-failure: throw AND success:false both
  transition to recovery_required + record failed dispatch (review 14B)**; retry leg
  (attempt 2 key, recovery -> approved -> dispatch, second failure -> recovery again).
- **db / store**: `listRecoveryRequiredLifecycles` + `countDispatchRecords` in
  `prisma-lifecycle-store.test.ts` (mocked Prisma, mirror existing cases).
- **api / feed**: parked lifecycle appears with the humanized card; degrades without
  lifecycleService; sort-before-cap (seed 26+, most-urgent retained, truncation logged);
  degraded card for missing trace; recovery_required card present.
- **api / respond**: lifecycle twin of api-approvals.test.ts via
  `buildTestServer({ lifecycle: true })` (opt-in; the legacy suite is untouched): approve
  executes the real transition AND real mode dispatch; reject; stale hash 400
  `stale_binding`; second respond 409 `already_responded`; principal mismatch 403;
  respondedBy server-derived; patch 400; self-approval blocked.
- **integration (the proving case)**: extract the #861 harness, then: cron parks -> REAL
  lifecycle row -> feed adapter surfaces rationale + campaign + bindingHash -> REAL
  `respondToParkedLifecycle` approve over the REAL `ApprovalLifecycleService` + REAL
  `PlatformLifecycle` + the harness's REAL `ExecutionModeRegistry` -> the REAL handoff
  handler runs -> Mira CreativeJob surfaces via the REAL `PrismaMiraCreativeReadModelReader`
  -> trace `completed`, lifecycle `approved`, DispatchRecord `succeeded`. Plus a
  dispatch-failure leg (broken handler -> recovery_required -> retry with fixed handler ->
  job exists). Mutation checks: rename the registered handler key (approve must fail
  visibly); skip executeApproved (no job); drop campaign id from the card (assertion fails).
- **dashboard**: action hook (endpoint, body, structured 409/400 branching); workflow item
  (no swipe commit); screen wiring (approve confirm flow carries bindingHash; reject fires
  reject; missing bindingHash refuses).

## 7. Delivery: five PRs, landed sequentially (review #12)

No stacking (squash-merge hazards); each lands on main before the next branches:

1. **PR-1 core read model**: decision types (`workflow_approval`, `RiskContract`,
   `meta.bindingHash`/`dispatchFailed`), agent-map entries, `scoreParkedApproval`,
   `adaptParkedApproval` + degraded/recovery variants.
2. **PR-2 core+db action path**: `InMemoryLifecycleStore`, store interface additions +
   `PrismaLifecycleStore` implementations, service passthroughs,
   `respondToParkedLifecycle` (payload authority, recovery transitions, retry, structured
   errors).
3. **PR-3 api wiring**: summarizer cards, feed leg, respond-route fallback, validation
   schema, test-server opt-in, `/pending` deprecation comments.
4. **PR-4 dashboard**: types, client widening, hook, inbox item + screen + sheet wiring.
5. **PR-5 integration proof**: harness extraction + the Riley -> Mira approval-loop test.

A docs PR (this spec + the plan) precedes them (branch doctrine).

## 8. Risks and honest limits

- Two store reads per parked unit (trace + revision); fine at parked-approval scale; cap 25
  applied AFTER expiry sort, truncation logged with hidden count.
- Reminder/followup intents render the (now conservative) default card in this slice.
- Patch is not supported on the lifecycle-native respond leg.
- No "abandon" action for a permanently failing dispatch (Retry card persists; honest state).
- Dev-no-DB keeps the legacy route-owned approval path end to end (unchanged).
- The legacy `GET /api/approvals/pending` is deprecated-in-place, still in-memory-backed;
  follow-up to migrate or retire.
- `InMemoryLifecycleStore` is exported from the core barrel (existing in-memory stores set
  the precedent); its docstring marks it test/dev-only, and production wiring constructs
  `PrismaLifecycleStore` exclusively (app.ts gates on prismaClient).
