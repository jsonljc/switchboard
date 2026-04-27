# Approval Lifecycle Completion v1 Design

**Date:** 2026-04-22
**Status:** Proposed for approval
**Goal:** Replace the current mixed approval/runtime path with one authoritative approval lifecycle that is durable, race-safe, and recoverable.

---

## Summary

Approval handling is still split across route handlers, PlatformIngress, PlatformLifecycle, SessionManager, ApprovalStore, EnvelopeStore, and WorkTraceStore. The system can produce a user-visible PENDING_APPROVAL result, but approval creation, approval state, reminders, post-approval execution, paused-session resume, retries, and recovery are not owned by one durable state machine.

That is not trustworthy enough for launch. Approval-gated work needs one authority model, one write discipline, one revocation mechanism, and one recovery model.

This design defines the long-term correct lifecycle shape:

- **ActionEnvelope** is immutable request authority
- **ApprovalLifecycle** is mutable approval/runtime gating authority
- **ApprovalRevision** is the immutable approval revision chain
- **ExecutableWorkUnit** is immutable execution authority derived from an approved revision
- **ExecutionAttempt** is the immutable concrete dispatch try
- **WorkTrace** is append-only historical truth and observability

The key invariant is:

> Current execution eligibility is read from ApprovalLifecycle, but actual dispatch is only allowed from a materialized ExecutableWorkUnit.

---

## Scope

### In Scope

- Approval creation
- Pending state and pending reads
- Approval revisioning
- Patch correctness
- Approval binding correctness
- Reminder scheduling
- Expiry handling
- Post-approval materialization and dispatch
- Paused-session resume
- Retry and replay discipline
- Reconciliation and recovery
- Migration from legacy live approval authority

### Out of Scope

- Full governance engine redesign
- Rich multi-stage human workflow UX beyond the lifecycle model defined here
- Full launch implementation of quorum and multi-approver UX if not completed end to end with the same guarantees

---

## Current Runtime Behavior

### Entry and Creation

- `POST /api/execute` and `POST /api/actions/propose` call `PlatformIngress.submit()`
- When governance returns `require_approval`, PlatformIngress persists WorkTrace with `outcome = pending_approval` and returns `approvalRequired: true`
- Approval creation does not happen inside PlatformIngress; the route calls `createApprovalForWorkUnit()` after ingress returns
- `POST /api/actions/batch` is divergent and can still return `PENDING_APPROVAL` without creating a persisted approval record

### Approval Record Creation

`createApprovalForWorkUnit()` currently:

- recomputes routing inputs outside the authoritative governance decision
- recomputes riskCategory from cartridge input or defaults to medium
- computes a narrow bindingHash from parameters plus hashed intent/actor snapshots
- hard-codes `envelopeVersion: 1`
- persists an approval row without atomically updating reminder state, post-approval dispatch state, or runtime gating state

### Pending State

- Pending reads come from stored approval status only
- Expiry is lazy and currently happens only when `respondToApproval()` is called after `expiresAt`
- `GET /api/approvals/pending` can therefore show already-expired work as pending
- `POST /api/approvals/:id/remind` can remind already-expired work because it keys off stored pending status, not active lifecycle truth

### Respond, Patch, and Execute

`PlatformLifecycle.respondToApproval()` currently:

- advances approval state first
- then mutates envelope and trace
- then executes or resumes inline
- does all of this without one durable lifecycle transaction

Current action semantics:

- **approve**: marks approval approved, updates envelope status, best-effort updates trace, executes immediately
- **reject**: marks approval rejected, updates envelope denied, best-effort updates trace, stops
- **patch**: marks approval patched, mutates envelope parameters in place, best-effort updates trace parameters, executes immediately

### Post-Approval Execution and Resume

- Post-approval execution is inline through `executeAfterApproval()`
- `executeAfterApproval()` reconstructs from WorkTrace first and only falls back to envelope data if trace data is missing
- If trace patch persistence fails but trace still exists, execution can run stale pre-patch parameters
- Session resume is route-owned and approve-only via `SessionManager.resumeAfterApproval()`
- Patch responses do not trigger resume
- Reject and expire do not resolve paused sessions explicitly
- Resume failure is best-effort and returned as warning only

### Side Paths

- `POST /api/actions/:id/execute` can still invoke `PlatformLifecycle.executeApproved()` directly
- Reminder delivery is a best-effort notifier path from the route
- Trace updates in PlatformLifecycle are explicitly best-effort and silently ignored on failure

---

## Main Trust Gaps

1. Approval creation is still route-owned and not authoritative end to end.
2. Approval routing can disagree with governance because routing inputs are recomputed outside the authoritative decision.
3. Binding integrity is incomplete because the runtime does not recompute authoritative current binding before approval-bearing actions.
4. Patch is not approval-correct because it mutates in place and executes immediately instead of creating a new immutable revision.
5. Expiry, reminders, and pending reads are time-inaccurate.
6. Resume is a best-effort side path instead of part of the lifecycle.
7. There is no durable retry/recovery model for post-approval work.
8. Manual execute remains a side path.
9. There is no single runtime owner for live approval authority.

---

## Goals

- Make approval creation, pending state, revisioning, patching, reminder scheduling, expiry, post-approval dispatch, resume, retry, and recovery part of one authoritative lifecycle.
- Ensure no approval response can execute stale or superseded work.
- Keep request authority, approval authority, execution authority, and history authority distinct.
- Eliminate route-owned and best-effort approval side effects.
- Make failures visible and recoverable instead of silently drifting across stores.

## Non-Goals

- Replacing the governance engine
- Designing operator-facing multi-stage UX beyond what this lifecycle requires
- Preserving old direct execution paths for convenience

---

## Authority Model

### Object Responsibilities

| Object             | Role                                                    | Mutability                 |
| ------------------ | ------------------------------------------------------- | -------------------------- |
| ActionEnvelope     | Immutable original request authority                    | Immutable                  |
| ApprovalLifecycle  | Mutable approval/runtime control-plane authority        | Mutable (pointer fields)   |
| ApprovalRevision   | Immutable revision chain for approval scope             | Immutable                  |
| ExecutableWorkUnit | Immutable dispatch authority from one approved revision | Immutable                  |
| ExecutionAttempt   | Immutable concrete dispatch try                         | Append-safe outcome fields |
| WorkTrace          | Append-only historical truth and observability          | Append-only                |

### Hard Invariant

Current approvability and executability are never inferred from WorkTrace, cached flags, or mutated envelope state. Current approval and dispatch authority are determined from ApprovalLifecycle and its pointers only.

---

## Core Data Model

### Cardinality

- v1: one ActionEnvelope -> one ApprovalLifecycle
- one ApprovalLifecycle -> many ApprovalRevisions
- one ApprovalLifecycle -> exactly one `current_revision_id`
- one ApprovalLifecycle -> zero or one `current_executable_work_unit_id`
- one ApprovalRevision -> zero or one ExecutableWorkUnit
- one ExecutableWorkUnit -> many ExecutionAttempts
- one ExecutionAttempt -> exactly one ExecutableWorkUnit

Future resubmission should create a new lifecycle in the same lineage group rather than mutating the old lifecycle.

### ApprovalLifecycle

Owns mutable fields:

- `status`: pending | approved | rejected | expired | superseded | recovery_required
- `current_revision_id`
- `current_executable_work_unit_id`
- `expires_at`
- reminder/timer/job references
- supersession references
- recovery state

ApprovalLifecycle.status must stay approval/control-plane oriented. It must not become a blended approval-plus-execution progress state machine.

### ApprovalRevision

Each revision is immutable and stores:

- `lifecycle_id`, `revision_number`
- parameter snapshot, approval-scope snapshot, approver/risk snapshot
- `binding_hash`
- rationale/notes
- `supersedes_revision_id`
- `created_by`, `created_at`

Patch always creates a new revision. No revision is ever mutated in place.

### ExecutableWorkUnit

Each executable work unit is immutable and stores:

- `lifecycle_id`, `approval_revision_id`, `action_envelope_id`
- frozen payload, frozen binding, frozen deployment/resolver target
- frozen execution policy snapshot
- `executable_until`
- lineage ids

It is the only object allowed to cross into dispatcher/runtime surfaces.

### ExecutionAttempt

Each execution attempt is immutable except append-safe operational outcome fields:

- `executable_work_unit_id`, `attempt_number`, `attempt_idempotency_key`
- `state`, dispatch/completion timestamps
- runtime target, transport ids, outcome, failure metadata

Linkage ids, binding, attempt number, and idempotency key are immutable.

### WorkTrace

WorkTrace is append-only and records lifecycle and execution events:

- `envelope_submitted`, `lifecycle_created`, `revision_created`
- `revision_approved`, `revision_rejected`, `revision_expired`
- `executable_work_unit_materialized`
- `execution_attempt_created`, `execution_attempt_dispatched`
- `execution_attempt_succeeded`, `execution_attempt_retryable_failed`, `execution_attempt_terminal_failed`
- `lifecycle_superseded`

WorkTrace is authoritative history, not authoritative current state.

---

## Approval Revision Model

### Principle

Approval is granted to a specific immutable revision of executable intent.

### Rules

- `approvalRevision` starts at 1
- each new patch creates revision N + 1
- previous revisions remain immutable historical truth
- previous revisions can be superseded but never mutated
- approval binds to a revision, not to a mutable lifecycle row

### Patch Semantics

Long-term supported commands:

- **patch_current_revision**: create new immutable revision from the current one, update `current_revision_id`, keep lifecycle pending
- **create_revision_and_approve**: create a new immutable revision, approve it in the same authority flow, materialize executable authority

There is no concept of patching an existing revision in place.

---

## Binding Correctness

### Binding Input

Authoritative binding must be recomputed from current stored authority using at least:

- workUnitId or envelope lineage id
- approvalRevision
- canonical parameters snapshot
- deployment identity / resolved target binding
- intent
- authoritative governance summary hash
- relevant context snapshot hash
- lifecycle or revision version material needed to detect stale client views

### Validation Rules

- `approve_revision` and `create_revision_and_approve` must validate the client binding hash against the authoritative current revision binding
- `patch_current_revision` validates the source revision binding before creating a new revision
- stale binding returns a typed stale-binding error with the latest current revision summary
- the client hash is only a stale-view detector; the server never trusts it as authority

---

## Runtime Flow

1. Request submission creates immutable ActionEnvelope
2. Gated work creates ApprovalLifecycle with revision 1 as pending
3. Patch or re-review creates new immutable ApprovalRevision and moves `current_revision_id`
4. Approving the current revision does not dispatch directly; it materializes one ExecutableWorkUnit
5. `ApprovalLifecycle.current_executable_work_unit_id` is atomically updated to that new work unit
6. Dispatcher may only accept the lifecycle's current pointed-to work unit
7. Each concrete dispatch try creates a new ExecutionAttempt
8. A newer approved revision can supersede prior executable authority by pointer movement without mutating old work units or attempts
9. WorkTrace records each boundary crossing as historical fact

### Revocation Mechanism

`ApprovalLifecycle.current_executable_work_unit_id` is the live executable authority pointer. Pointer movement is the revocation mechanism. Old work units remain historically true but lose executable authority as soon as the lifecycle pointer moves away from them.

### Materialization Rule

Materializing a new ExecutableWorkUnit and updating the lifecycle pointer must happen in one transaction.

---

## Admission And Race Handling

Dispatcher admission must verify all of the following:

- the ExecutableWorkUnit is structurally valid and within its execution window
- `ApprovalLifecycle.status === "approved"`
- `ApprovalLifecycle.current_executable_work_unit_id` equals that work unit id

Pointer mismatch is a hard stale-authority rejection, not a retryable failure.

Additional invariants:

- an ExecutableWorkUnit can only be created from an approved ApprovalRevision
- an ApprovalRevision can materialize at most one ExecutableWorkUnit
- a superseded executable work unit must never be dispatched
- an ExecutionAttempt must reference exactly one ExecutableWorkUnit, never a raw revision
- dispatcher admission must ignore cached current flags and rely on lifecycle pointer plus lifecycle status

---

## Services And Transaction Ownership

### ApprovalLifecycleService

Owns all control-plane mutations: lifecycle creation, revision creation, approve/reject/expire/supersede, executable materialization, lifecycle pointer updates. This is the only service allowed to mutate approval authority.

### ExecutionDispatchService

Owns runtime-boundary behavior: dispatcher admission, execution attempt creation, dispatch, attempt outcome recording. It may read lifecycle and executable authority, but it may only mutate ExecutionAttempt directly.

### ApprovalLifecycleReconciler

Owns invariant scans and repair flows. Repair logic is operationally distinct from normal lifecycle mutation but follows the same authority rules.

### WorkTraceProjector

Projects committed authority transitions into WorkTrace. It listens and appends, never decides authority. It must project from committed authoritative mutations, never from caller intent.

### Write Discipline

- no route writes authority tables directly
- no projector writes authority tables
- no dispatcher writes ApprovalRevision
- all pointer swaps happen inside ApprovalLifecycleService
- no service may mutate a table it does not own except through an explicit documented handoff path

### Core Principle

Every authoritative mutation happens in one service with one transaction boundary, and every historical record is projected from that mutation rather than co-owned by the caller.

---

## Transaction Boundaries

### Submit Gated Request

One transaction: create ActionEnvelope, create ApprovalLifecycle, create initial ApprovalRevision, emit committed projector input.

### Patch / New Revision

One transaction: create new ApprovalRevision, update `ApprovalLifecycle.current_revision_id`, emit committed projector input.

### Approve Current Revision

One transaction, in this order:

1. validate lifecycle still pending
2. validate revision still current
3. create ExecutableWorkUnit
4. set `ApprovalLifecycle.status = approved`
5. set `current_executable_work_unit_id`
6. commit
7. project committed trace events

### Dispatch Attempt

One transaction before crossing the runtime boundary: re-check lifecycle admission invariants, create ExecutionAttempt, mark it dispatching, commit. Only after commit may the runtime boundary be crossed.

### Attempt Completion

One transaction: update ExecutionAttempt, emit committed projector input, mutate ApprovalLifecycle only if policy explicitly requires control-plane change.

---

## Database Constraints And Structural Invariants

### Foreign Keys and Uniqueness

| Field                                               | Constraint                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ApprovalLifecycle.action_envelope_id`              | FK to ActionEnvelope.id, unique in v1                                                  |
| `ApprovalRevision.lifecycle_id`                     | FK to ApprovalLifecycle.id, unique on (lifecycle_id, revision_number)                  |
| `ApprovalLifecycle.current_revision_id`             | FK to ApprovalRevision.id                                                              |
| `ExecutableWorkUnit.lifecycle_id`                   | FK to ApprovalLifecycle.id                                                             |
| `ExecutableWorkUnit.approval_revision_id`           | FK to ApprovalRevision.id, unique                                                      |
| `ApprovalLifecycle.current_executable_work_unit_id` | FK to ExecutableWorkUnit.id                                                            |
| `ExecutionAttempt.executable_work_unit_id`          | FK to ExecutableWorkUnit.id                                                            |
| `ExecutionAttempt`                                  | unique on (executable_work_unit_id, attempt_number), unique on attempt_idempotency_key |

### Status / Pointer Compatibility

Use DB-level checks where possible:

- if `status = 'pending'`: `current_revision_id IS NOT NULL`, `current_executable_work_unit_id IS NULL`
- if `status = 'approved'`: `current_revision_id IS NOT NULL`, `current_executable_work_unit_id IS NOT NULL` as a persisted post-commit invariant

Service-layer admission must additionally deny when lifecycle status is: rejected, expired, superseded, recovery_required.

### Pointer Legitimacy

`ApprovalLifecycle.current_executable_work_unit_id`, if set, must point to a work unit derived from the lifecycle's current revision. Currentness is defined only by lifecycle pointers -- no `is_current` flag is authoritative.

### Immutability

- ActionEnvelope immutable after creation
- ApprovalRevision immutable
- ExecutableWorkUnit immutable
- ExecutionAttempt mutable only in append-safe operational outcome fields

Supersession is expressed by lifecycle pointer movement and lineage, never by overwriting historical rows.

---

## Failure Ownership And Recovery

### Failure Ownership

- control-plane ambiguity lives on ApprovalLifecycle
- dispatch/runtime failure lives on ExecutionAttempt
- a failed ExecutionAttempt does not by itself revoke approval
- ApprovalLifecycle moves to `recovery_required` only when the system cannot safely determine the current executable authority or next safe step

### Reconciler Scan Set

The reconciler scans for:

- approved lifecycle with no current executable work unit when one should exist
- lifecycle/current revision/current work unit lineage incompatibility
- attempts stuck in dispatching
- lifecycle pointer targeting invalid or expired work units
- multiple historical work units where none or more than one appear authoritative under invariant checks
- legacy pending objects that were not migrated but remain actionable

### Recovery Rule

Recovery never infers current authority from history. It only uses history to explain how authority became inconsistent. Current authority is repaired from authoritative objects and invariant checks, never replayed out of WorkTrace.

---

## Pending Reads, Reminders, and Expiry

Pending reads must come from ApprovalLifecycle current-state truth, not stored request status.

### Reminders

- reminder scheduling is lifecycle-owned
- manual remind schedules reminder work; it does not deliver notifications inline
- reminders apply only while lifecycle is current, pending, and not expired

### Expiry

- expiry is active, not lazy
- expiry transitions operate on lifecycle authority, not on stale route-time checks
- expiry of current pending approval updates lifecycle state and prevents later dispatch even if stale work remains queued

---

## Session Resume Convergence

Paused-session resume is part of lifecycle authority, not a route hook.

Rules:

- approval records may reference paused workflow/session context
- approve or create-revision-and-approve may schedule or trigger lifecycle-owned resume follow-up
- reject, expire, and supersede must explicitly resolve paused-session implications
- no approval response may mark a pause consumed or a session running unless the durable follow-up decision has been committed in the same authority flow

---

## API And Command Surface

### External API Surface

Routes are transport adapters only:

- `POST /api/execute`
- `POST /api/actions/propose`
- `GET /api/approvals/:id`
- `GET /api/approvals/pending`
- `POST /api/approvals/:id/respond`
- `POST /api/approvals/:id/remind`

If `POST /api/actions/:id/execute` remains temporarily, it must resolve internally to "dispatch current executable work unit after lifecycle admission checks." It must not bypass lifecycle authority.

### Internal Commands

Public route actions must map immediately into explicit internal commands:

- `create_gated_lifecycle`
- `create_revision`
- `approve_revision`
- `reject_revision`
- `create_revision_and_approve`
- `expire_lifecycle`
- `dispatch_executable_work_unit`
- `record_execution_attempt_outcome`
- `reconcile_lifecycle`

There should be no generic route-shaped "respond" blob at the authority layer.

### Response Rule

- routes return lifecycle-derived projections
- routes never compute authority from envelope or trace
- routes do not perform notifier, reminder, or dispatch side effects inline
- side effects react only after committed authority mutation

---

## Migration And Rollout

### Rollout Principle

Legacy history can survive as history. Legacy live authority cannot survive past cutover. We can tolerate legacy historical rows. We must not tolerate legacy live authority.

### Phase 1: Introduce Authority Objects

- add ApprovalLifecycle and ApprovalRevision
- all new gated requests create them
- new authority objects become canonical for gating state immediately
- old execution path may remain behind compatibility shim temporarily

**Cutover marker:** all new gated requests create lifecycle + revision

### Phase 2: Freeze Dispatch Behind ExecutableWorkUnit

- approval no longer dispatches directly
- approved revisions materialize ExecutableWorkUnit
- dispatcher refuses raw approval/lifecycle inputs
- dispatcher accepts only executable work unit ids plus lifecycle admission checks

**Cutover marker:** dispatcher admission accepts only ExecutableWorkUnit

### Phase 3: Move Runtime Truth Onto ExecutionAttempt

- every dispatch creates attempt first
- runtime outcomes update attempts, not lifecycle directly
- retries create new attempts on the same work unit
- route-owned reminder/resume behavior is removed in favor of committed command -> async reaction flow

**Cutover marker:** runtime callbacks mutate ExecutionAttempt, not lifecycle

### Phase 4: Strict Mode

- legacy live authority paths are removed
- pending reads come only from lifecycle projections
- reconciler is required infrastructure
- legacy envelope/trace-derived approval logic is deleted

**Cutover marker:** strict mode enabled only when dispatcher admission, reconciler health, and lifecycle-derived reads are all green

### Migration Rules

- no dual-authority period where old and new models can disagree without one being clearly non-authoritative
- compatibility shims are read-through / command-forwarding only, not alternate mutation paths
- no phase may require routes to write one authority model while workers write another
- cutovers happen at transaction boundaries, never split across routes and workers

### Pending Legacy Objects

- migrated pending objects become actionable under the new authority model
- unmigrated pending objects are frozen
- frozen legacy pending objects cannot be approved, rejected, reminded, resumed, or dispatched except through explicit migration/reconciliation command

### Historical Legacy Objects

Legacy historical rows may feed read models and projections but must never be reactivated into live authority without explicit rematerialization into the new model.

---

## Testing And Verification

### Testing Principle

Verify authority invariants, transaction boundaries, race revocation, recovery behavior, and migration fencing at the object/service layer. Route tests are secondary and exist to prove correct command routing and absence of bypass paths.

### Core Invariant Tests

- ActionEnvelope is immutable
- ApprovalRevision is immutable and revision numbers are unique per lifecycle
- approving a non-current revision is rejected
- one revision materializes at most one work unit
- dispatcher only trusts the lifecycle's current pointer target
- dispatcher rejects when lifecycle status is not approved
- pointer swap supersedes old executable authority without mutating old work units or attempts

### Transaction-Boundary Tests

- approval atomically creates ExecutableWorkUnit and updates lifecycle pointer
- dispatch atomically creates ExecutionAttempt and persists dispatching before runtime handoff
- crash after attempt create but before runtime call is recoverable without duplicate dispatch
- crash after runtime call but before durable outcome write leads to reconciler-driven repair, not guessed state

### Race-Condition Tests

- stale queued work unit is denied after pointer move
- concurrent approve/materialize operations cannot create two current executable authorities
- concurrent dispatches are controlled by attempt/idempotency rules
- superseding lifecycle during queued dispatch causes hard stale-authority rejection

### Database-Constraint Tests

- duplicate revision number per lifecycle fails
- second work unit for same revision fails
- duplicate attempt number for same work unit fails
- duplicate attempt idempotency key fails
- invalid constrained lineage insert fails

### Migration-Cutover Tests

- migrated pending object is actionable
- unmigrated pending object is frozen
- compatibility shim forwards into authority services only
- strict mode rejects legacy execution path

### Launch Verification Bar

- zero public bypass paths in route inventory
- all admission tests green
- reconciler invariant scan passes on seeded broken-state scenarios
- lifecycle-derived pending reads are active in prod-like environment
- compatibility shim audit shows no direct legacy authority writes
- no live authority can be inferred from WorkTrace, cached flags, or legacy envelope state

Strict mode does not turn on until all of the above are green.

---

## Recommendations

### Long-Term Design Center

Anchor on the hybrid authority model:

- immutable request authority in ActionEnvelope
- mutable control-plane authority in ApprovalLifecycle
- immutable approval truth in ApprovalRevision
- immutable dispatch authority in ExecutableWorkUnit
- immutable attempt truth in ExecutionAttempt
- append-only historical truth in WorkTrace

### Long-Term Guardrails

- ApprovalLifecycle never becomes a blended approval-plus-execution progress row
- WorkTrace never becomes current authority
- routes remain thin transport shells
- dispatcher never accepts raw lifecycle or revision ids
- compatibility layers may translate calls, but may not own authority

### v1 Slice Guidance

Even if implementation phases the model in incrementally, preserve these object boundaries from day one. Temporary compatibility is acceptable. Temporary blended authority is not.
