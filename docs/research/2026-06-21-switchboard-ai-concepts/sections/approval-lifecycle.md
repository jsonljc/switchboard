## Approval gates & full approval lifecycle

When an autonomous agent can spend money, send messages to customers, or mutate external systems, you need a place where a human can say "yes, do exactly this" before it happens, and you need that yes to be auditable, tamper-proof, and recoverable when execution fails. This cluster is Switchboard's answer: a small state machine (the _approval lifecycle_) that sits between governance (the gate that decides whether human sign-off is needed) and execution (the dispatch engine that actually runs the action). The transferable idea is **human-in-the-loop as durable state, not as a UI callback**. Approval is modeled as rows in a database with versions, frozen snapshots, and explicit terminal states, so that an approval can survive a process crash, a redeploy, or a multi-day delay, and so that the thing the operator approved is provably the thing that runs.

A useful mental model before the details: an inbound action flows `ingress -> governance gate -> (execute | deny | park) `. "Park" means create an `ApprovalLifecycle` in `pending`. An operator later responds (`approve` / `patch` / `reject`). Approve _materializes_ a frozen `ExecutableWorkUnit` and then _dispatches_ it. If dispatch fails, the lifecycle becomes `recovery_required` and comes back to the operator as a retry card. Expiry sweeps abandoned pending approvals to `expired`.

### ApprovalLifecycleStatus: the state set

A lifecycle state machine needs a closed, named set of states so every consumer reasons about the same world. Vague "is it done?" booleans rot; an enum forces exhaustive handling.

**In Switchboard.** Six states are defined as a Zod enum in [packages/schemas/src/approval-lifecycle.ts:3-10](packages/schemas/src/approval-lifecycle.ts):

```ts
export const ApprovalLifecycleStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
  "recovery_required",
]);
```

The persisted row ([packages/schemas/src/approval-lifecycle.ts:13-25](packages/schemas/src/approval-lifecycle.ts)) carries `status`, a `version` integer (`min(1)`) used for optimistic locking, `currentRevisionId`, `currentExecutableWorkUnitId`, `expiresAt`, and a nullable `organizationId` for tenant scoping. The schema is the contract; the Prisma model in `packages/db/prisma/schema.prisma` stores it with `status String @default("pending")`.

**How it's used at runtime.** Every transition routes through `ApprovalLifecycleService.transitionStatus` / `updateLifecycleStatus`, which is version-checked and org-scoped (see store below). `pending` is the only non-terminal, operator-actionable-via-respond state; `recovery_required` is the second actionable state ([packages/core/src/approval/lifecycle-service.ts:62-68](packages/core/src/approval/lifecycle-service.ts)); `approved` is a committed-but-maybe-not-yet-run state; `rejected`/`expired` are terminal.

**Gotchas.** `superseded` is declared but **unimplemented**. No code path emits it (grep for it: only the enum and a UI design doc reference it). The system today allows multiple coexisting `pending` approvals for the same action rather than superseding older ones. Treat it as aspirational, not behavior you can rely on.

### Creating a gated lifecycle (the park)

When a gate returns "needs approval", you must atomically persist _both_ the lifecycle and an immutable first snapshot of what is being approved, or you risk an approval pointing at nothing.

**In Switchboard.** `PrismaLifecycleStore.createLifecycleWithRevision` ([packages/db/src/storage/prisma-lifecycle-store.ts:21-60](packages/db/src/storage/prisma-lifecycle-store.ts)) writes the `ApprovalLifecycle` (`status: "pending"`, `version: 1`, `currentRevisionId` pointing at the revision) and the `ApprovalRevision` (revisionNumber 1, `parametersSnapshot`, `approvalScopeSnapshot`, `bindingHash`, `createdBy`) inside one `prisma.$transaction([...])`. The service entry is `createGatedLifecycle` ([lifecycle-service.ts:70-74](packages/core/src/approval/lifecycle-service.ts)).

The producer is `PlatformIngress.submit` step 6 ([packages/core/src/platform/platform-ingress.ts:303-348](packages/core/src/platform/platform-ingress.ts)). On a `require_approval` decision it first persists the `WorkTrace` with outcome `pending_approval`, then computes a binding hash and calls `createGatedLifecycle` with `expiresAt = now + routingConfig.defaultExpiryMs`, returning `approvalRequired: true, lifecycleId, bindingHash` to the caller.

**How it's used at runtime.** An inbound chat or API action -> `submit` -> `GovernanceGate.evaluate` returns `require_approval` -> trace persisted as `pending_approval` -> lifecycle + revision row created -> `approvalNotifier.notify(...)` fired-and-forget (Slack/UI). The operator sees a card.

**Gotchas.** Notification is best-effort: a throwing notifier is caught and logged so it can never fail the park ([platform-ingress.ts:375-381](packages/core/src/platform/platform-ingress.ts)). And the lifecycle is only created _if_ `config.lifecycleService` is wired; otherwise `submit` falls back to legacy `approvalRequired: true` with no lifecycle row. Whether you are on the lifecycle path is a deployment-config fact, not a guarantee.

### Binding hash: approve-exactly-what-runs integrity

A binding hash is a content hash over everything that defines an action (envelope, params, governance decision, actor), so a later "approve" can prove the parameters haven't silently changed between display and execution. This is the structural defense against the "approve blindly" and "swap the payload after sign-off" attacks.

**In Switchboard.** `computeBindingHash` ([packages/core/src/approval/binding.ts:4-22](packages/core/src/approval/binding.ts)) canonicalizes (`canonicalizeSync`, a deterministic JSON serializer so key order can't change the hash) over `envelopeId`, `envelopeVersion`, `actionId`, `parameters`, `decisionTraceHash`, and `contextSnapshotHash`, then SHA-256s it. `validateBindingHash` compares with `timingSafeEqual` to avoid timing side channels.

```ts
const input = canonicalizeSync({
  envelopeId,
  envelopeVersion,
  actionId,
  parameters,
  decisionTraceHash,
  contextSnapshotHash,
});
return createHash("sha256").update(input).digest("hex");
```

The hash is produced at park time ([platform-ingress.ts:325-331](packages/core/src/platform/platform-ingress.ts)) and validated on approve and on patch: `approveRevision` throws `"Stale binding"` if `currentRevision.bindingHash !== clientBindingHash` ([lifecycle-service.ts:132-134](packages/core/src/approval/lifecycle-service.ts)); `createRevision` throws if `sourceBindingHash` doesn't match ([lifecycle-service.ts:95-97](packages/core/src/approval/lifecycle-service.ts)).

**Gotcha.** The operator UI must echo the hash it was shown back into the approve call. If parameters were patched, the hash changes (new revision, new hash), so an approve carrying the _old_ hash is rejected as stale, forcing the operator to re-confirm the new parameters.

### Revisions, patching, and supersession

Operators often want to nudge parameters before approving (lower a spend, fix a phone number). You model this as _append-only revisions_ rather than mutating the original, so the audit trail shows exactly what was proposed, what was changed, and by whom.

**In Switchboard.** `respondViaLifecycle` builds a patched param set (`{...trace.parameters, ...patchValue}`), computes a fresh binding hash, and calls `createRevision` with `supersedesRevisionId = currentRevision.id` ([packages/core/src/approval/respond-via-lifecycle.ts:97-122](packages/core/src/approval/respond-via-lifecycle.ts)). The store assigns `revisionNumber = max + 1` and re-points `lifecycle.currentRevisionId` via an org-scoped `updateMany`, throwing on `count === 0` (tenant mismatch) ([prisma-lifecycle-store.ts:92-129](packages/db/src/storage/prisma-lifecycle-store.ts)). `createRevision` is only legal while the lifecycle is `pending` ([lifecycle-service.ts:87-89](packages/core/src/approval/lifecycle-service.ts)).

**How it's used at runtime.** `patch` action -> create new revision (supersedes prior) -> immediately `approveLifecycle` against the _new_ revision's hash -> dispatch. Patch is a combined patch-and-approve in this path; the legacy surface contract is "patch responds AND executes".

**Gotcha.** Revisions form a `supersedesRevisionId` chain, but `currentRevisionId` is the single source of truth for "what approve commits". Don't confuse the chain (history) with the pointer (authority).

### Approve: the authority commit and materialization

Approval is the irreversible commit. The two dangerous failure modes are (a) approving but then executing different parameters, and (b) two approvals racing and double-committing. Switchboard closes both with a frozen snapshot plus optimistic locking.

**In Switchboard.** `approveRevision` validates the client hash, then `buildMaterializationInput` ([packages/core/src/approval/executable-materializer.ts:22-41](packages/core/src/approval/executable-materializer.ts)) freezes a payload: `frozenPayload` (intent, `revision.parametersSnapshot`, actor, org, mode, traceId), `frozenBinding` (deployment context), `frozenExecutionPolicy` (governance constraints), and `executableUntil = now + executableUntilMs` (default 3,600,000 ms). `approveAndMaterialize` ([prisma-lifecycle-store.ts:183-227](packages/db/src/storage/prisma-lifecycle-store.ts)) runs both writes in one transaction:

```ts
this.prisma.approvalLifecycle.updateMany({
  where: { id: lifecycleId, version: expectedVersion, organizationId },
  data: { status: "approved", version: expectedVersion + 1,
          currentExecutableWorkUnitId: workUnitId },
}),
this.prisma.executableWorkUnit.create({ data: { id: workUnitId, ... } }),
```

If the `updateMany` matched zero rows (someone else already advanced the version, or wrong org), it throws `StaleVersionError` and the whole transaction rolls back. The `version + organizationId` predicate is doing double duty: optimistic concurrency _and_ tenant isolation.

**How it's used at runtime.** Operator clicks approve -> `respondToApproval` (dispatcher) -> `respondViaLifecycle` -> `approveLifecycle` (authority commit) -> trace gets the frozen payload written -> dispatch. The `ExecutableWorkUnit` is now the immutable authority; the dispatch engine reads from it, never from live params.

**Gotcha.** `executableUntil` means an approved-but-undispatched unit can go stale. `validateDispatchAdmission` ([packages/core/src/approval/dispatch-admission.ts:46-52](packages/core/src/approval/dispatch-admission.ts)) refuses to dispatch a unit past `executableUntil` (`EXPIRED_WORK_UNIT`), so a long-delayed dispatch fails closed rather than running aged authority.

### Dispatch and the "fail toward dispatch-or-recovery" invariant

Once you've committed an approval, the action must _visibly_ either succeed or fail; it must never evaporate into a log line. Switchboard encodes this as an ordering invariant: after the authority commit, every later step fails _toward_ dispatch-or-recovery, never away from it.

**In Switchboard.** `runDispatch` ([packages/core/src/approval/lifecycle-dispatch.ts:79-121](packages/core/src/approval/lifecycle-dispatch.ts)) computes `attemptNumber = countDispatchAttempts + 1`, creates a `DispatchRecord` with deterministic idempotency key `lifecycle-dispatch:<lifecycleId>:<revisionId>:attempt-<n>`, calls `platformLifecycle.executeApproved(lifecycle.actionEnvelopeId)` (which dispatches _from_ the WorkTrace that now carries the frozen payload), then `recordDispatchOutcome`. On a thrown error OR `success: false`, it calls `markRecoveryRequired`:

```ts
const fresh = await deps.lifecycleService.getLifecycleById(lifecycleId);
if (!fresh || fresh.status !== "approved") return;
await deps.lifecycleService.transitionStatus(fresh, "recovery_required");
```

Crucially, in `respondViaLifecycle` the legacy-row sync and envelope flip _after_ the authority commit are wrapped in try/catch and logged, never aborting ([respond-via-lifecycle.ts:163-195](packages/core/src/approval/respond-via-lifecycle.ts)). The comment is explicit: aborting here "would recreate the bare-approve hole".

**Gotcha.** Dispatch admission ([dispatch-admission.ts:20-53](packages/core/src/approval/dispatch-admission.ts)) checks four things in order: status is `approved`, the work unit's `lifecycleId` matches (`LINEAGE_MISMATCH`), it is the lifecycle's _current_ executable (`STALE_AUTHORITY`, catches dispatching a superseded unit), and not expired. A patched-then-re-approved lifecycle will have a new current work unit; the old one is now stale by design.

### Recovery_required and retry without re-approval

If an approved action's external call fails (network, rate limit, downstream 500), you don't want to re-run governance and re-collect a human approval. You want a retry that reuses the already-approved authority.

**In Switchboard.** `recovery_required` surfaces alongside `pending` via `listOperatorActionableLifecycles` ([lifecycle-service.ts:62-68](packages/core/src/approval/lifecycle-service.ts)). `respondToParkedLifecycle` ([packages/core/src/approval/respond-to-parked-lifecycle.ts:109-114](packages/core/src/approval/respond-to-parked-lifecycle.ts)) special-cases it:

```ts
if (lifecycle.status === "recovery_required") {
  if (params.action !== "approve") throw new ParkedLifecycleAlreadyRespondedError(...);
  return retryDispatch(deps, params, lifecycle);
}
```

`retryDispatch` reuses the existing `ExecutableWorkUnit` and bumps `attemptNumber` (the next deterministic idempotency key), so the `DispatchRecord` history accumulates `attempt-1`, `attempt-2`, ... as an audit trail. No new revision, no new governance pass.

**Gotcha.** Only `approve` is legal on a `recovery_required` lifecycle; reject/patch throw. The state is deliberately a narrow "retry or leave it" fork.

### Rejection and integrity-before-mutation

Rejecting must terminate the action _and_ keep canonical persistence (the `WorkTrace`) consistent. A subtle trap: never reject a trace whose integrity flags would let it skip governance on a later replay.

**In Switchboard.** `rejectLifecycle` ([lifecycle-service.ts:191-244](packages/core/src/approval/lifecycle-service.ts)) reads the trace and runs `assertExecutionAdmissible` _before_ any mutation; only then `rejectRevision` flips status to `rejected` (version-checked), and finally it updates the WorkTrace to `outcome: "failed", approvalOutcome: "rejected"`. If that trace update returns `!ok`, it **throws** rather than swallow the divergence:

```ts
if (!updateResult.ok)
  throw new Error(
    `WorkTrace update failed during rejectLifecycle (${lifecycleId}): ${updateResult.reason}`,
  );
```

**Gotcha.** Note the asymmetry vs approve: reject keeps a _legacy-first_ ordering ([respond-via-lifecycle.ts:242-279](packages/core/src/approval/respond-via-lifecycle.ts)) because no dispatch is at stake, so a raced reject dying on the legacy optimistic lock safely leaves the lifecycle `pending` and retryable. Approve flips that order because after the authority commit nothing may stand between it and dispatch.

### Expiry sweep

Pending approvals must not block an action forever. A background sweep transitions overdue pending lifecycles to the terminal `expired`.

**In Switchboard.** `listExpiredPendingLifecycles` queries `status: "pending", expiresAt: { lte: cutoff }` ([prisma-lifecycle-store.ts:285-294](packages/db/src/storage/prisma-lifecycle-store.ts)). `sweepExpiredLifecycles` ([packages/core/src/approval/lifecycle-expiry.ts:10-35](packages/core/src/approval/lifecycle-expiry.ts)) iterates and calls `expireLifecycle` on each, returning `{ expired, failed, errors }`. `expireLifecycle` is a no-op if the lifecycle is no longer `pending` ([lifecycle-service.ts:246-257](packages/core/src/approval/lifecycle-service.ts)), so a race with a concurrent approve is harmless. Separately, `listPendingLifecycles` in the _service_ filters out already-overdue rows in memory ([lifecycle-service.ts:259-263](packages/core/src/approval/lifecycle-service.ts)), so operators never see a card that will be swept.

**Gotcha.** Once `expired`, a lifecycle is terminal; `respondToParkedLifecycle` proactively expires-and-throws if it sees an overdue pending on approve ([respond-to-parked-lifecycle.ts:118-121](packages/core/src/approval/respond-to-parked-lifecycle.ts)), closing the window where an operator approves a just-expired card.

### Governance gate: where the require_approval decision is born

The lifecycle never decides _whether_ approval is needed; the governance gate does. Separating "should this be gated?" (policy) from "run the gate" (lifecycle) keeps each concern testable.

**In Switchboard.** `GovernanceGate.evaluate` ([packages/core/src/platform/governance/governance-gate.ts:143-272](packages/core/src/platform/governance/governance-gate.ts)) returns a `GovernanceDecision` with `outcome: "execute" | "require_approval" | "deny"`. It short-circuits to `execute` for `approvalMode === "system_auto_approved"` **but explicitly falls through to the full policy path for financial intents** so a spend-bearing action can never auto-approve ([governance-gate.ts:165-193](packages/core/src/platform/governance/governance-gate.ts)). It then loads identity/policies/cartridge/profile, runs the policy engine to a `DecisionTrace`, and finally `applySpendApprovalThreshold` can relax a reversible under-threshold financial `require_approval` to `execute`, or escalate an over-threshold execute, but never touches a `deny`.

**Gotcha.** `system_auto_approved` bypassing the human policy is a known sharp edge (see project memory `feedback_system_auto_approved_bypasses_spend_gates`). The financial-intent fall-through at lines 182-193 is the structural guard that keeps "financial intents are require_approval, never auto-approved" an invariant rather than a convention.

### Store interface, dispatcher fork, and quorum

Two remaining pieces tie it together. `ApprovalLifecycleStore` ([packages/core/src/approval/lifecycle-types.ts:54-115](packages/core/src/approval/lifecycle-types.ts)) is the persistence boundary so core depends on an interface, not Prisma; the in-memory implementation backs tests, `PrismaLifecycleStore` backs prod. Every mutating store method threads `version + organizationId` for lock-and-isolate.

`respondToApproval` ([packages/core/src/approval/respond-to-approval.ts:112-160](packages/core/src/approval/respond-to-approval.ts)) is the single response entry point. It looks up a lifecycle by envelope id; if present it runs the four-eyes self-approval guard (`assertNotSelfApproval`, default-deny, escape hatch `selfApprovalAllowed` from `ALLOW_SELF_APPROVAL`) and forks to `respondViaLifecycle`; otherwise it falls back to the legacy `platformLifecycle.respondToApproval`. Both share the `transitionApproval` state machine.

**Quorum.** `transitionApproval` ([packages/core/src/approval/state-machine.ts:56-115](packages/core/src/approval/state-machine.ts)) supports N-of-M sign-off: on `approve` with a `quorum`, it rejects duplicate approvers, appends a `QuorumEntry`, and only returns `status: "approved"` once `approvalHashes.length >= required`. In `respondViaLifecycle` a partial quorum short-circuits ([respond-via-lifecycle.ts:71-85](packages/core/src/approval/respond-via-lifecycle.ts)): it records the partial on the legacy row and leaves the lifecycle `pending` and undispatched. Only the final approver triggers materialize + dispatch.

**What to study next.** Trace one full path end to end with the file references above: `submit` (park) -> `createGatedLifecycle` -> operator -> `respondToApproval` -> `respondViaLifecycle` -> `approveLifecycle`/`approveAndMaterialize` -> `runDispatch` -> `recordDispatchOutcome` / `markRecoveryRequired`. The single most important invariant to internalize is the ordering discipline after the authority commit (`respond-via-lifecycle.ts` lines 124-217): everything after `approveLifecycle` is best-effort-toward-dispatch, so an approved action always lands in a visible terminal-or-recoverable state.
