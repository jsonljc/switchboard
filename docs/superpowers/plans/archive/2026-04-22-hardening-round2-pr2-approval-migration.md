# Hardening Round 2 — PR2: Approval Migration + Rip-and-Replace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the approval respond path from legacy `PlatformLifecycle.respondToApproval()` to `ApprovalLifecycleService`, then delete all legacy runtime code.

**Architecture:** Part A rewires `approvals.ts` to call the lifecycle service (which already exists from PR #241). Part B deletes dead code — operator, scheduler, simulate, pipeline-mode, orchestrator, ExecutionService, MCP in-memory mode, and the `/remind` endpoint.

**Tech Stack:** TypeScript, Fastify, Prisma, Vitest

**Spec:** `docs/superpowers/specs/2026-04-22-hardening-round2-design.md`

**Split guidance:** If Part A and Part B entangle during implementation, ship Part A as PR2A and Part B as PR2B.

---

## Part A — Migrate Approval Respond

### Task 1: Add `approveLifecycle` dispatch method to ApprovalLifecycleService

The lifecycle service already has `approveRevision()` (which materializes an executable work unit) and `prepareDispatch()` (which validates dispatch admission). This task adds a high-level `approveLifecycle()` that chains them together and dispatches via ModeRegistry.

**`approveLifecycle()` must be the only place that can dispatch approved work for lifecycle-backed approvals.** No side-door dispatch paths.

**Files:**

- Modify: `packages/core/src/approval/lifecycle-service.ts`
- Modify: `packages/core/src/approval/__tests__/lifecycle-service.test.ts`

- [ ] **Step 1: Write failing test for approveLifecycle**

In `packages/core/src/approval/__tests__/lifecycle-service.test.ts`, add a test:

```typescript
describe("approveLifecycle", () => {
  it("transitions lifecycle to approved, materializes work unit, and dispatches", async () => {
    // Setup: create a lifecycle with a pending revision
    const { lifecycle, revision } = await service.createGatedLifecycle({
      actionEnvelopeId: "env-1",
      organizationId: "org-1",
      expiresAt: new Date(Date.now() + 86400000),
      initialRevision: {
        parametersSnapshot: { campaignId: "camp-1" },
        approvalScopeSnapshot: { approvers: ["approver-1"], riskCategory: "medium" },
        bindingHash: "hash-1",
        createdBy: "originator",
      },
    });

    const mockWorkUnit = {
      id: lifecycle.actionEnvelopeId,
      requestedAt: new Date().toISOString(),
      organizationId: "org-1",
      actor: { id: "originator", type: "user" as const },
      intent: "campaign.pause",
      parameters: revision.parametersSnapshot,
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "campaign",
        trustLevel: "supervised" as const,
        trustScore: 0,
      },
      resolvedMode: "skill" as const,
      traceId: "trace-1",
      trigger: "api" as const,
      priority: "normal" as const,
    };

    const result = await service.approveLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: "approver-1",
      clientBindingHash: revision.bindingHash,
      workUnit: mockWorkUnit,
      actionEnvelopeId: lifecycle.actionEnvelopeId,
      constraints: {},
    });

    expect(result.lifecycle.status).toBe("approved");
    expect(result.executableWorkUnit).toBeDefined();
    expect(result.executableWorkUnit.frozenPayload.parameters).toEqual({ campaignId: "camp-1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run -t "approveLifecycle"`

Expected: FAIL — method doesn't exist yet.

- [ ] **Step 3: Implement approveLifecycle**

In `packages/core/src/approval/lifecycle-service.ts`, add method to the `ApprovalLifecycleService` class:

```typescript
  async approveLifecycle(params: {
    lifecycleId: string;
    respondedBy: string;
    clientBindingHash: string;
    workUnit: WorkUnit;
    actionEnvelopeId: string;
    constraints: Record<string, unknown>;
    executableUntilMs?: number;
  }): Promise<{ lifecycle: LifecycleRecord; executableWorkUnit: ExecutableWorkUnit }> {
    const { lifecycle, workUnit: executableWorkUnit } = await this.approveRevision({
      lifecycleId: params.lifecycleId,
      respondedBy: params.respondedBy,
      clientBindingHash: params.clientBindingHash,
      materializationParams: {
        workUnit: params.workUnit,
        actionEnvelopeId: params.actionEnvelopeId,
        constraints: params.constraints,
        executableUntilMs: params.executableUntilMs ?? 3600000,
      },
    });

    return { lifecycle, executableWorkUnit };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run -t "approveLifecycle"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add approveLifecycle to ApprovalLifecycleService

Single dispatch path for lifecycle-backed approvals. Chains
approveRevision + materialization into one call.
EOF
)"
```

---

### Task 2: Add `rejectLifecycle` with terminal WorkTrace update

**Files:**

- Modify: `packages/core/src/approval/lifecycle-service.ts`
- Modify: `packages/core/src/approval/__tests__/lifecycle-service.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("rejectLifecycle", () => {
  it("transitions lifecycle to rejected and updates WorkTrace to terminal rejected", async () => {
    const { lifecycle } = await service.createGatedLifecycle({
      actionEnvelopeId: "env-reject",
      organizationId: "org-1",
      expiresAt: new Date(Date.now() + 86400000),
      initialRevision: {
        parametersSnapshot: { campaignId: "camp-1" },
        approvalScopeSnapshot: { approvers: ["approver-1"] },
        bindingHash: "hash-reject",
        createdBy: "originator",
      },
    });

    const result = await service.rejectLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: "approver-1",
      traceStore: mockTraceStore,
    });

    expect(result.status).toBe("rejected");
    expect(mockTraceStore.update).toHaveBeenCalledWith(
      lifecycle.actionEnvelopeId,
      expect.objectContaining({ outcome: "rejected" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run -t "rejectLifecycle"`

Expected: FAIL — the existing `rejectRevision` doesn't update WorkTrace.

- [ ] **Step 3: Implement rejectLifecycle**

Add to `lifecycle-service.ts`, plus import `WorkTraceStore`:

```typescript
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";

// ... in class body:

  async rejectLifecycle(params: {
    lifecycleId: string;
    respondedBy: string;
    traceStore: WorkTraceStore;
  }): Promise<LifecycleRecord> {
    const lifecycle = await this.rejectRevision({
      lifecycleId: params.lifecycleId,
      respondedBy: params.respondedBy,
    });

    await params.traceStore.update(lifecycle.actionEnvelopeId, {
      outcome: "rejected",
      completedAt: new Date().toISOString(),
      approvalOutcome: "rejected",
      approvalRespondedBy: params.respondedBy,
      approvalRespondedAt: new Date().toISOString(),
    });

    return lifecycle;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run -t "rejectLifecycle"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add rejectLifecycle with terminal WorkTrace update

Ensures rejected lifecycle also transitions WorkTrace to terminal
rejected outcome — no split-brain between lifecycle and trace.
EOF
)"
```

---

### Task 3: Rewire approvals.ts to use ApprovalLifecycleService

**Files:**

- Modify: `apps/api/src/routes/approvals.ts`
- Modify: `apps/api/src/app.ts` (expose `lifecycleService` on Fastify)

- [ ] **Step 1: Check if lifecycleService is already decorated on the Fastify app**

Search `apps/api/src/app.ts` for `lifecycleService` decoration. If not decorated, add it:

```typescript
// In the FastifyInstance interface:
lifecycleService: ApprovalLifecycleService | null;

// In buildServer(), after platformIngress construction:
app.decorate("lifecycleService", lifecycleService ?? null);
```

Where `lifecycleService` is the same instance passed to `platformIngress.config.lifecycleService`.

- [ ] **Step 2: Rewrite the respond endpoint in approvals.ts**

Replace the body of the `/:id/respond` handler (lines 33-103). The new flow:

```typescript
try {
  // Org access check
  const approval = await app.storageContext.approvals.getById(id);
  if (!approval) {
    return reply.code(404).send({ error: "Approval not found", statusCode: 404 });
  }
  if (!assertOrgAccess(request, approval.organizationId, reply)) return;

  // Principal auth check
  const authenticatedPrincipal = request.principalIdFromAuth;
  if (authenticatedPrincipal && authenticatedPrincipal !== body.respondedBy) {
    return reply.code(403).send({
      error: `Forbidden: authenticated principal '${authenticatedPrincipal}' cannot respond as '${body.respondedBy}'`,
      statusCode: 403,
    });
  }

  // Require bindingHash for approve/patch
  if ((body.action === "approve" || body.action === "patch") && !body.bindingHash) {
    return reply.code(400).send({
      error: "bindingHash is required for approve and patch actions",
      statusCode: 400,
    });
  }

  const lifecycleService = app.lifecycleService;

  // Try lifecycle-backed path first (new system)
  if (lifecycleService && approval.request.lifecycleId) {
    if (body.action === "approve") {
      // Look up the WorkTrace to build a WorkUnit for dispatch
      const trace = await app.storageContext.workTraces.getByWorkUnitId(approval.envelopeId);
      if (!trace) {
        return reply.code(500).send({ error: "WorkTrace not found for approval", statusCode: 500 });
      }

      const workUnit = traceToWorkUnit(trace);
      const result = await lifecycleService.approveLifecycle({
        lifecycleId: approval.request.lifecycleId,
        respondedBy: body.respondedBy,
        clientBindingHash: body.bindingHash ?? "",
        workUnit,
        actionEnvelopeId: approval.envelopeId,
        constraints: trace.governanceConstraints ?? {},
      });

      return reply.code(200).send({
        lifecycle: result.lifecycle,
        executableWorkUnit: result.executableWorkUnit,
        outcome: "approved",
      });
    } else if (body.action === "reject") {
      const lifecycle = await lifecycleService.rejectLifecycle({
        lifecycleId: approval.request.lifecycleId,
        respondedBy: body.respondedBy,
        traceStore: app.storageContext.workTraces,
      });

      return reply.code(200).send({ lifecycle, outcome: "rejected" });
    } else if (body.action === "patch") {
      // Create new revision with patched parameters
      const currentRevision = await lifecycleService.store.getCurrentRevision(
        approval.request.lifecycleId,
      );
      if (!currentRevision) {
        return reply.code(500).send({ error: "No current revision found", statusCode: 500 });
      }

      const patchedParams = { ...currentRevision.parametersSnapshot, ...body.patchValue };
      const newBindingHash = computeBindingHash({
        envelopeId: approval.envelopeId,
        envelopeVersion: 1,
        actionId: `prop_${approval.envelopeId}`,
        parameters: patchedParams,
        decisionTraceHash: hashObject({ intent: "patched" }),
        contextSnapshotHash: hashObject({ actor: body.respondedBy }),
      });

      const newRevision = await lifecycleService.createRevision({
        lifecycleId: approval.request.lifecycleId,
        parametersSnapshot: patchedParams,
        approvalScopeSnapshot: currentRevision.approvalScopeSnapshot,
        bindingHash: newBindingHash,
        createdBy: body.respondedBy,
        sourceBindingHash: body.bindingHash ?? "",
        rationale: "Patched and approved",
      });

      // Now approve with the new revision's binding hash
      const trace = await app.storageContext.workTraces.getByWorkUnitId(approval.envelopeId);
      if (!trace) {
        return reply.code(500).send({ error: "WorkTrace not found", statusCode: 500 });
      }

      const workUnit = traceToWorkUnit(trace);
      workUnit.parameters = patchedParams;

      const result = await lifecycleService.approveLifecycle({
        lifecycleId: approval.request.lifecycleId,
        respondedBy: body.respondedBy,
        clientBindingHash: newRevision.bindingHash,
        workUnit,
        actionEnvelopeId: approval.envelopeId,
        constraints: trace.governanceConstraints ?? {},
      });

      return reply.code(200).send({
        lifecycle: result.lifecycle,
        executableWorkUnit: result.executableWorkUnit,
        outcome: "patched_and_approved",
      });
    }
  }

  // Fallback: legacy PlatformLifecycle path (for approvals without lifecycleId)
  const response = await app.platformLifecycle.respondToApproval({
    approvalId: id,
    action: body.action,
    respondedBy: body.respondedBy,
    bindingHash: body.bindingHash ?? "",
    patchValue: body.patchValue,
  });

  return reply.code(200).send({
    envelope: response.envelope,
    approvalState: response.approvalState,
    executionResult: response.executionResult,
  });
} catch (err) { ... }
```

Note: Add a helper function `traceToWorkUnit(trace: WorkTrace): WorkUnit` at the top of the file that maps a WorkTrace to a WorkUnit shape.

- [ ] **Step 3: Delete the `/remind` endpoint (lines 150-201)**

Remove the entire `app.post("/:id/remind", ...)` block.

- [ ] **Step 4: Write integration tests for the new approval flow**

Create or update `apps/api/src/__tests__/api-approvals.test.ts` with tests covering:

- Approve via lifecycle service (lifecycle-backed approval)
- Reject via lifecycle service (trace transitions to terminal rejected)
- Patch via lifecycle service (new revision created, patched params are canonical)
- Fallback to legacy path when no lifecycleId exists

- [ ] **Step 5: Run all tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run`

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: rewire approval respond to ApprovalLifecycleService

Lifecycle-backed approvals now flow through approveLifecycle/
rejectLifecycle/createRevision. Legacy PlatformLifecycle path remains
as fallback for approvals without lifecycleId. Deletes /remind endpoint
(notifier was never wired).
EOF
)"
```

---

## Part B — Dead Code and Legacy Runtime Removal

**Pre-delete gate for every target:** Search for all imports/references before deleting. If still referenced, rewire or fail compile. Never silently preserve.

### Task 4: Delete simulate routes and PlatformLifecycle.simulate()

**Files:**

- Delete: `apps/api/src/routes/simulate.ts`
- Delete: `apps/api/src/routes/simulate-chat.ts`
- Modify: `apps/api/src/bootstrap/routes.ts` (remove simulate registration)
- Modify: `apps/api/src/__tests__/test-server.ts` (remove simulate registration)
- Modify: `packages/core/src/platform/platform-lifecycle.ts` (remove simulate method)

- [ ] **Step 1: Sweep all references to simulate**

Run: `grep -rn "simulate" apps/api/src/ --include="*.ts" | grep -v ".test." | grep -v "node_modules" | grep -v "dist/"`

Verify the only references are in `routes.ts`, `test-server.ts`, `simulate.ts`, and `simulate-chat.ts`.

- [ ] **Step 2: Remove simulate route registration from routes.ts**

In `apps/api/src/bootstrap/routes.ts`, remove:

- Import: `import { simulateRoutes } from "../routes/simulate.js";`
- Registration: `await app.register(simulateRoutes, { prefix: "/api/simulate" });`

- [ ] **Step 3: Remove simulate from test-server.ts**

In `apps/api/src/__tests__/test-server.ts`, remove:

- Import: `import { simulateRoutes } from "../routes/simulate.js";`
- Registration: `await app.register(simulateRoutes, { prefix: "/api/simulate" });`

- [ ] **Step 4: Delete simulate files**

```bash
rm apps/api/src/routes/simulate.ts apps/api/src/routes/simulate-chat.ts
```

- [ ] **Step 5: Remove simulate() method from PlatformLifecycle**

In `packages/core/src/platform/platform-lifecycle.ts`, delete the `simulate()` method (lines 282-301).

- [ ] **Step 6: Run tests**

Run: `npx pnpm@9.15.4 test`

Expected: All PASS. If any test was testing simulate, delete that test too.

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: delete simulate routes and PlatformLifecycle.simulate()

Legacy simulation path removed. GovernanceGate simulation (Phase 7)
will be built fresh when needed.
EOF
)"
```

---

### Task 5: Delete operator and scheduler stubs

**Files:**

- Delete: `apps/api/src/bootstrap/operator-deps.ts`
- Delete: `apps/api/src/routes/operator.ts`
- Delete: `apps/api/src/bootstrap/scheduler-deps.ts`
- Modify: `apps/api/src/bootstrap/routes.ts` (remove operator registration)
- Modify: `apps/api/src/app.ts` (remove operator/scheduler decorations)

- [ ] **Step 1: Sweep all references**

```bash
grep -rn "operatorDeps\|operatorRoutes\|buildOperatorDeps\|schedulerDeps\|buildSchedulerDeps\|schedulerService\|OperatorDeps\|SchedulerDeps" apps/api/src/ --include="*.ts" | grep -v "dist/"
```

- [ ] **Step 2: Remove from routes.ts**

Remove operator import and registration from `apps/api/src/bootstrap/routes.ts`.

- [ ] **Step 3: Remove from app.ts**

In `apps/api/src/app.ts`:

- Remove `schedulerService` and `operatorDeps` from `FastifyInstance` interface (lines 58-59)
- Remove scheduler deps import and construction (lines 250-258)
- Remove operator deps decoration (line 261)
- Remove scheduler cleanup in close hook (lines 474-475)

- [ ] **Step 4: Remove scheduler route if it guards on null**

Check `apps/api/src/routes/scheduler.ts` — if it only uses `app.schedulerService` and guards on null, decide: delete the route file, or leave it and remove the guard. Since scheduler is fully stubbed, delete the route.

- [ ] **Step 5: Delete files**

```bash
rm apps/api/src/bootstrap/operator-deps.ts apps/api/src/routes/operator.ts apps/api/src/bootstrap/scheduler-deps.ts
```

- [ ] **Step 6: Run tests, fix any broken imports**

Run: `npx pnpm@9.15.4 test`

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: delete operator and scheduler stubs

Both returned null with no runtime implementation. Routes guarded on
null and were effectively dead code.
EOF
)"
```

---

### Task 6: Delete pipeline-mode (orphaned)

**Files:**

- Delete: `packages/core/src/platform/modes/pipeline-mode.ts`
- Delete: `packages/core/src/platform/__tests__/pipeline-mode.test.ts`

- [ ] **Step 1: Verify no imports exist**

```bash
grep -rn "PipelineMode\|pipeline-mode" packages/core/src/ apps/ --include="*.ts" | grep -v "dist/" | grep -v "pipeline-mode.ts" | grep -v "pipeline-mode.test.ts"
```

Confirm zero results (already verified in audit).

- [ ] **Step 2: Delete files**

```bash
rm packages/core/src/platform/modes/pipeline-mode.ts packages/core/src/platform/__tests__/pipeline-mode.test.ts
```

- [ ] **Step 3: Check mode index for re-export**

If `packages/core/src/platform/modes/index.ts` re-exports pipeline-mode, remove that line.

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run`

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: delete orphaned pipeline-mode

Never registered in app.ts, superseded by WorkflowMode.
EOF
)"
```

---

### Task 7: Remove ExecutionService and LifecycleOrchestrator from app.ts

This is the largest deletion. `app.orchestrator` is still referenced by `execute.ts` and `actions.ts` for `routingConfig`. We need to either move `routingConfig` to a standalone config or make it available through the platform stack.

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/execute.ts`
- Modify: `apps/api/src/routes/actions.ts`
- Modify: `apps/api/src/routes/approval-factory.ts`
- Delete: `packages/core/src/execution-service.ts` (if no other consumers)

- [ ] **Step 1: Sweep all `app.orchestrator` references**

Already found: `execute.ts:110`, `actions.ts:125` — both use `app.orchestrator.routingConfig`.

- [ ] **Step 2: Extract routingConfig to standalone Fastify decoration**

In `apps/api/src/app.ts`, find where `routingConfig` is configured (it was passed to the `LifecycleOrchestrator` constructor). Extract it:

```typescript
// In FastifyInstance interface, replace orchestrator with:
approvalRoutingConfig: ApprovalRoutingConfig;

// In buildServer(), replace orchestrator construction with:
const approvalRoutingConfig: ApprovalRoutingConfig = {
  defaultApprovers: [process.env["DEFAULT_APPROVER"] ?? "admin"],
  defaultFallbackApprover: process.env["FALLBACK_APPROVER"] ?? null,
  defaultExpiryMs: 24 * 60 * 60 * 1000,
  // ... copy from existing orchestrator config
};
app.decorate("approvalRoutingConfig", approvalRoutingConfig);
```

- [ ] **Step 3: Update execute.ts and actions.ts**

Replace `app.orchestrator.routingConfig` with `app.approvalRoutingConfig` in both files.

- [ ] **Step 4: Remove orchestrator and executionService construction from app.ts**

Remove:

- `LifecycleOrchestrator` import and construction (lines 314-331)
- `ExecutionService` construction (line 334)
- `app.decorate("orchestrator", orchestrator)` (line 335)
- `app.decorate("executionService", executionService)` (line 339)
- Remove `orchestrator` and `executionService` from `FastifyInstance` interface

- [ ] **Step 5: Remove approvalNotifier construction from app.ts**

Since `/remind` was deleted in Task 3, remove:

- `TelegramApprovalNotifier`, `SlackApprovalNotifier`, `CompositeNotifier` imports
- `approvalNotifiers` array construction (lines 264-287)
- Passing `approvalNotifier` to orchestrator (no longer constructed)

- [ ] **Step 6: Delete ExecutionService if no other consumers**

```bash
grep -rn "ExecutionService" packages/core/src/ apps/ --include="*.ts" | grep -v "dist/" | grep -v "test" | grep -v "execution-service.ts"
```

If only MCP server uses it, that gets handled in Task 8. Delete `packages/core/src/execution-service.ts` if the only remaining consumer is the MCP in-memory mode (also being deleted).

- [ ] **Step 7: Run tests, fix broken imports**

Run: `npx pnpm@9.15.4 test`

Fix any test files that referenced `app.orchestrator`.

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: remove LifecycleOrchestrator and ExecutionService from app.ts

routingConfig extracted to standalone Fastify decoration. All routes
now use PlatformIngress/PlatformLifecycle/ApprovalLifecycleService.
No dual runtime stack.
EOF
)"
```

---

### Task 8: Delete MCP in-memory legacy mode

**Files:**

- Modify: `apps/mcp-server/src/main.ts`

- [ ] **Step 1: Remove in-memory mode (lines 109-153)**

Keep only the API mode path (lines 38-107). The in-memory mode constructs its own `LifecycleOrchestrator` and `ExecutionService` — both are being deleted.

- [ ] **Step 2: Update buildMutationModeGuard to require SWITCHBOARD_API_URL**

```typescript
export function buildMutationModeGuard(): void {
  const apiUrl = process.env["SWITCHBOARD_API_URL"];
  if (!apiUrl) {
    throw new Error(
      "SWITCHBOARD_API_URL is required. " +
        "The MCP server delegates all operations to the Switchboard API.",
    );
  }
}
```

- [ ] **Step 3: Remove unused imports from main.ts**

Remove: `LifecycleOrchestrator`, `createInMemoryStorage`, `seedDefaultStorage`, `InMemoryLedgerStorage`, `AuditLedger`, `createGuardrailState`, `DEFAULT_REDACTION_CONFIG`, `InMemoryPolicyCache`, `InMemoryGovernanceProfileStore`, `ExecutionService`, `CartridgeReadAdapter`.

- [ ] **Step 4: Run MCP server tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/mcp-server test -- --run`

Fix any tests that relied on in-memory mode.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: remove MCP in-memory mode

MCP server now requires SWITCHBOARD_API_URL and delegates all
operations to the API. No standalone orchestrator.
EOF
)"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx pnpm@9.15.4 test`

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`

- [ ] **Step 4: Verify invariants**

Search for any remaining references to deleted code:

```bash
grep -rn "LifecycleOrchestrator\|ExecutionService\|app\.orchestrator\|app\.executionService\|simulateRoutes\|operatorRoutes\|PipelineMode\|app\.schedulerService\|app\.operatorDeps\|approvalNotifier" apps/ packages/ --include="*.ts" | grep -v "dist/" | grep -v ".test." | grep -v "__tests__"
```

Expected: Zero results (or only in type declarations that are also being cleaned).

- [ ] **Step 5: Create PR**

```bash
git checkout -b fix/hardening-round2-pr2-approval-migration
git push -u origin fix/hardening-round2-pr2-approval-migration
```
