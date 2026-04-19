# P0 Convergence Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate dual approval ownership, block auth bypass in production, delete dead single-tenant chat path.

**Architecture:** Five sequential PRs. P0b fixes the dashboard auth bypass. P0a (3 PRs) consolidates approval into PlatformLifecycle: port patched re-evaluation, move execution ownership, delete old approval machinery. P0c deletes ~2,300 lines of dead single-tenant chat code.

**Tech Stack:** TypeScript, Vitest, Fastify, Prisma, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-04-19-p0-convergence-design.md`

---

## PR: P0b — Auth Bypass Production Guard

### Task 1: Block dev auth bypass in production

**Files:**

- Modify: `apps/dashboard/src/lib/session.ts:20`
- Create: `apps/dashboard/src/lib/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/dashboard/src/lib/__tests__/session.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("getServerSession", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("blocks dev bypass when NODE_ENV is production", async () => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = "true";
    process.env.NODE_ENV = "production";
    const { getServerSession } = await import("../session.js");
    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it("allows dev bypass when NODE_ENV is not production", async () => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = "true";
    process.env.NODE_ENV = "development";
    const { getServerSession } = await import("../session.js");
    const session = await getServerSession();
    expect(session).not.toBeNull();
    expect(session?.user.id).toBe("dev-user");
  });
});
```

Note: The `getServerSession` function calls `auth()` from NextAuth when bypass is not active. The test for the production case should work because with bypass blocked, it falls through to `auth()` which returns `null` in the test environment (no real NextAuth session). If the `auth` import fails in test, mock it:

```ts
vi.mock("../auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter dashboard exec vitest run src/lib/__tests__/session.test.ts`
Expected: The "blocks dev bypass" test FAILS (currently returns `DEV_SESSION` even in production).

- [ ] **Step 3: Add the production guard**

In `apps/dashboard/src/lib/session.ts`, change line 20 from:

```ts
  if (process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true") {
```

to:

```ts
  if (
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter dashboard exec vitest run src/lib/__tests__/session.test.ts`
Expected: Both tests PASS.

- [ ] **Step 5: Run full CI checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass. No regressions.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: block dashboard auth bypass in production

NEXT_PUBLIC_DEV_BYPASS_AUTH=true in session.ts now requires
NODE_ENV !== "production", matching the existing guard in
get-api-client.ts. Prevents accidental auth bypass if the
env var leaks into a production build.
EOF
)"
```

---

## PR: P0a-PR1 — Approval Feature Parity + Cleanup

### Task 2: Write PlatformLifecycle base correctness tests

These tests cover existing PlatformLifecycle behavior that is currently untested.

**Files:**

- Create: `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`

- [ ] **Step 1: Write lifecycle correctness tests**

```ts
// packages/core/src/platform/__tests__/platform-lifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { timingSafeEqual } from "node:crypto";
import { PlatformLifecycle } from "../platform-lifecycle.js";
import type { PlatformLifecycleConfig, ApprovalResponseResult } from "../platform-lifecycle.js";
import type { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type { WorkTrace } from "../work-trace.js";
import type { AuditLedger } from "../../audit/ledger.js";
import type { ActionEnvelope, RiskCategory } from "@switchboard/schemas";
import { createApprovalState } from "../../approval/state-machine.js";

function createMockStores() {
  const traces: WorkTrace[] = [];
  const traceStore: WorkTraceStore = {
    persist: vi.fn(async (t: WorkTrace) => {
      traces.push(t);
    }),
    getByWorkUnitId: vi.fn(async (id: string) => traces.find((t) => t.workUnitId === id) ?? null),
    update: vi.fn(async (id: string, fields: Partial<WorkTrace>) => {
      const idx = traces.findIndex((t) => t.workUnitId === id);
      if (idx >= 0) traces[idx] = { ...traces[idx]!, ...fields };
    }),
  };

  const approvals = new Map<
    string,
    {
      request: { actionId: string; bindingHash: string; riskCategory: string; approvers: string[] };
      state: ReturnType<typeof createApprovalState>;
      envelopeId: string;
      organizationId: string | null;
    }
  >();

  const approvalStore = {
    getById: vi.fn(async (id: string) => approvals.get(id) ?? null),
    updateState: vi.fn(async (id: string, state: unknown, _version: number) => {
      const a = approvals.get(id);
      if (a) a.state = state as typeof a.state;
    }),
    save: vi.fn(async (record: unknown) => {
      const r = record as {
        request: { id: string };
        envelopeId: string;
        organizationId: string | null;
        state: unknown;
      };
      approvals.set(r.request.id, r as never);
    }),
    listPending: vi.fn(async () => []),
  };

  const envelopes = new Map<string, ActionEnvelope>();
  const envelopeStore = {
    getById: vi.fn(async (id: string) => envelopes.get(id) ?? null),
    update: vi.fn(async (id: string, fields: Partial<ActionEnvelope>) => {
      const e = envelopes.get(id);
      if (e) Object.assign(e, fields);
    }),
    list: vi.fn(async () => []),
  };

  const identityStore = {
    getPrincipal: vi.fn(async () => ({ id: "responder", organizationId: "org-1", roles: [] })),
    listDelegationRules: vi.fn(async () => []),
    getSpecByPrincipalId: vi.fn(async () => null),
    listOverlaysBySpecId: vi.fn(async () => []),
  };

  const modeRegistry: ExecutionModeRegistry = {
    dispatch: vi.fn(async () => ({
      workUnitId: "wu-1",
      outcome: "completed" as const,
      summary: "Done",
      outputs: {},
      mode: "skill",
      durationMs: 100,
      traceId: "trace-1",
    })),
    register: vi.fn(),
  } as unknown as ExecutionModeRegistry;

  const ledger: AuditLedger = {
    record: vi.fn(async () => {}),
  } as unknown as AuditLedger;

  return {
    traceStore,
    traces,
    approvalStore,
    approvals,
    envelopeStore,
    envelopes,
    identityStore,
    modeRegistry,
    ledger,
  };
}

function seedApproval(
  stores: ReturnType<typeof createMockStores>,
  opts: {
    approvalId?: string;
    workUnitId?: string;
    actorId?: string;
    bindingHash?: string;
    expiresAt?: Date;
  } = {},
) {
  const approvalId = opts.approvalId ?? "appr-1";
  const workUnitId = opts.workUnitId ?? "wu-1";
  const bindingHash = opts.bindingHash ?? "hash-abc";
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + 3600_000);

  stores.approvals.set(approvalId, {
    request: {
      actionId: `prop_${workUnitId}`,
      bindingHash,
      riskCategory: "medium",
      approvers: [],
    },
    state: createApprovalState(expiresAt),
    envelopeId: workUnitId,
    organizationId: "org-1",
  });

  const envelope: ActionEnvelope = {
    id: workUnitId,
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: [
      {
        id: `prop_${workUnitId}`,
        actionType: "test.action",
        parameters: { _principalId: opts.actorId ?? "actor-1", _organizationId: "org-1" },
        sideEffect: true,
      } as never,
    ],
    resolvedEntities: [],
    plan: null,
    decisions: [],
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: [],
    status: "pending_approval",
    createdAt: new Date(),
    updatedAt: new Date(),
    parentEnvelopeId: null,
    traceId: "trace-1",
  };
  stores.envelopes.set(workUnitId, envelope);

  stores.traces.push({
    workUnitId,
    traceId: "trace-1",
    intent: "test.action",
    parameters: { _principalId: opts.actorId ?? "actor-1" },
    actor: { id: opts.actorId ?? "actor-1", type: "user" },
    organizationId: "org-1",
    requestedAt: new Date().toISOString(),
    governanceOutcome: "require_approval",
    outcome: "pending_approval",
    mode: "skill",
    riskScore: 0.5,
    matchedPolicies: [],
    trigger: "api",
  } as WorkTrace);

  return { approvalId, workUnitId, bindingHash };
}

function buildLifecycle(stores: ReturnType<typeof createMockStores>): PlatformLifecycle {
  return new PlatformLifecycle({
    approvalStore: stores.approvalStore as never,
    envelopeStore: stores.envelopeStore as never,
    identityStore: stores.identityStore as never,
    modeRegistry: stores.modeRegistry,
    traceStore: stores.traceStore,
    ledger: stores.ledger,
  });
}

describe("PlatformLifecycle", () => {
  let stores: ReturnType<typeof createMockStores>;

  beforeEach(() => {
    stores = createMockStores();
  });

  describe("respondToApproval", () => {
    it("approve → execute → trace updated", async () => {
      const lifecycle = buildLifecycle(stores);
      const { approvalId, bindingHash } = seedApproval(stores);

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "approve",
        respondedBy: "responder",
        bindingHash,
      });

      expect(result.executionResult).not.toBeNull();
      expect(stores.traceStore.update).toHaveBeenCalled();
      const updateCall = vi
        .mocked(stores.traceStore.update)
        .mock.calls.find((c) => c[1].approvalOutcome === "approved");
      expect(updateCall).toBeDefined();
    });

    it("reject → trace shows failed + rejected", async () => {
      const lifecycle = buildLifecycle(stores);
      const { approvalId, bindingHash } = seedApproval(stores);

      await lifecycle.respondToApproval({
        approvalId,
        action: "reject",
        respondedBy: "responder",
        bindingHash,
      });

      expect(stores.traceStore.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          approvalOutcome: "rejected",
          outcome: "failed",
        }),
      );
    });

    it("expired approval → envelope expired → trace updated", async () => {
      const lifecycle = buildLifecycle(stores);
      const { approvalId, bindingHash } = seedApproval(stores, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "approve",
        respondedBy: "responder",
        bindingHash,
      });

      expect(result.approvalState.status).toBe("expired");
      expect(result.executionResult).toBeNull();
    });

    it("self-approval prevention", async () => {
      const lifecycle = buildLifecycle(stores);
      const { approvalId, bindingHash } = seedApproval(stores, { actorId: "responder" });

      await expect(
        lifecycle.respondToApproval({
          approvalId,
          action: "approve",
          respondedBy: "responder",
          bindingHash,
        }),
      ).rejects.toThrow("Self-approval is not permitted");
    });

    it("binding hash mismatch", async () => {
      const lifecycle = buildLifecycle(stores);
      seedApproval(stores);

      await expect(
        lifecycle.respondToApproval({
          approvalId: "appr-1",
          action: "approve",
          respondedBy: "responder",
          bindingHash: "wrong-hash",
        }),
      ).rejects.toThrow("Binding hash mismatch");
    });

    it("rate limiting", async () => {
      const lifecycle = new PlatformLifecycle({
        approvalStore: stores.approvalStore as never,
        envelopeStore: stores.envelopeStore as never,
        identityStore: stores.identityStore as never,
        modeRegistry: stores.modeRegistry,
        traceStore: stores.traceStore,
        ledger: stores.ledger,
        approvalRateLimit: { maxApprovals: 1, windowMs: 60_000 },
      });

      const s1 = seedApproval(stores, { approvalId: "appr-1", workUnitId: "wu-1" });
      await lifecycle.respondToApproval({
        approvalId: s1.approvalId,
        action: "approve",
        respondedBy: "responder",
        bindingHash: s1.bindingHash,
      });

      const s2 = seedApproval(stores, { approvalId: "appr-2", workUnitId: "wu-2" });
      await expect(
        lifecycle.respondToApproval({
          approvalId: s2.approvalId,
          action: "approve",
          respondedBy: "responder",
          bindingHash: s2.bindingHash,
        }),
      ).rejects.toThrow("Approval rate limit exceeded");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

These test existing behavior, so they should pass immediately.

Run: `pnpm --filter @switchboard/core exec vitest run src/platform/__tests__/platform-lifecycle.test.ts`
Expected: All 6 tests PASS. If any fail, adjust the mock setup to match the actual `PlatformLifecycle` interface before proceeding.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test: add PlatformLifecycle base correctness tests

Cover approve/reject/expire/self-approval/binding-hash/rate-limit
paths that were previously untested. Foundation for parity tests
in the approval consolidation sprint.
EOF
)"
```

### Task 3: Port patched re-evaluation into PlatformLifecycle

**Files:**

- Modify: `packages/core/src/platform/platform-lifecycle.ts`
- Modify: `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`

- [ ] **Step 1: Write parity tests for patched re-evaluation**

Add to the test file from Task 2:

```ts
describe("patch re-evaluation", () => {
  it("denies when patched parameters violate policy", async () => {
    const lifecycle = buildLifecycle(stores);
    const { approvalId, bindingHash } = seedApproval(stores);

    // Set up cartridge that returns high risk for patched params
    const cartridge = {
      enrichContext: vi.fn(async () => ({})),
      getRiskInput: vi.fn(async () => ({
        baseRisk: "critical" as const,
        exposure: { dollarsAtRisk: 100000, blastRadius: 100 },
        reversibility: "none" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      })),
      getGuardrails: vi.fn(() => []),
      manifest: { actions: [] },
    };
    stores.identityStore.getSpecByPrincipalId.mockResolvedValue({
      id: "spec-1",
      principalId: "actor-1",
      roles: [],
      permissions: [],
    });

    // Register the cartridge
    const cartridgeRegistry = { get: vi.fn(() => cartridge), list: vi.fn(() => ["test"]) };
    (stores as any)._cartridgeRegistry = cartridgeRegistry;

    // Configure lifecycle with cartridge registry access for re-evaluation
    const lifecycleWithCartridge = new PlatformLifecycle({
      approvalStore: stores.approvalStore as never,
      envelopeStore: stores.envelopeStore as never,
      identityStore: stores.identityStore as never,
      modeRegistry: stores.modeRegistry,
      traceStore: stores.traceStore,
      ledger: stores.ledger,
      cartridgeRegistry: cartridgeRegistry as never,
      policyStore: {
        listActive: vi.fn(async () => [
          { effect: "deny", conditions: { riskCategory: { op: "eq", value: "critical" } } },
        ]),
      } as never,
    });

    const result = await lifecycleWithCartridge.respondToApproval({
      approvalId,
      action: "patch",
      respondedBy: "responder",
      bindingHash,
      patchValue: { amount: 999999 },
    });

    expect(result.executionResult).toBeNull();
    // Envelope should be denied
    const envelope = stores.envelopes.get("wu-1");
    expect(envelope?.status).toBe("denied");
  });

  it("executes when patched parameters pass re-evaluation", async () => {
    const lifecycle = buildLifecycle(stores);
    const { approvalId, bindingHash } = seedApproval(stores);

    // No cartridge registry = no re-evaluation = execute
    const result = await lifecycle.respondToApproval({
      approvalId,
      action: "patch",
      respondedBy: "responder",
      bindingHash,
      patchValue: { amount: 50 },
    });

    expect(result.executionResult).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify the deny test fails**

Run: `pnpm --filter @switchboard/core exec vitest run src/platform/__tests__/platform-lifecycle.test.ts`
Expected: "denies when patched parameters violate policy" FAILS — current PlatformLifecycle does not re-evaluate.

- [ ] **Step 3: Add cartridge/policy dependencies to PlatformLifecycleConfig**

In `packages/core/src/platform/platform-lifecycle.ts`, add to the config interface:

```ts
// Add these imports at the top
import type { CartridgeRegistry } from "../storage/interfaces.js";
import type { PolicyStore } from "../storage/interfaces.js";
import { evaluate } from "../engine/policy-engine.js";
import type { PolicyEngineContext } from "../engine/policy-engine.js";
import type { EvaluationContext } from "../engine/rule-evaluator.js";
import { resolveIdentity } from "../identity/spec.js";

// Add to PlatformLifecycleConfig:
export interface PlatformLifecycleConfig {
  // ... existing fields ...
  cartridgeRegistry?: CartridgeRegistry;
  policyStore?: PolicyStore;
  guardrailState?: import("../engine/policy-engine.js").GuardrailState;
}
```

- [ ] **Step 4: Port the re-evaluation logic into respondToApproval patch handling**

In `platform-lifecycle.ts`, in the `respondToApproval` method, replace the patch handling block (around line 157-176) with re-evaluation logic ported from `approval-manager.ts:408-509`.

The key change: before executing after a patch, check if a cartridge registry is available. If so, re-evaluate the patched parameters against governance. If denied, update trace and envelope and return without executing.

```ts
// Inside respondToApproval, in the "patch" case:
} else if (params.action === "patch") {
  if (params.patchValue && envelope?.proposals[0]) {
    envelope.proposals[0].parameters = applyPatch(
      envelope.proposals[0].parameters,
      params.patchValue,
    );

    // Re-evaluate patched parameters against governance
    // Temporary parity shim (2A-i) — scope limited to this method only
    const denied = await this.reEvaluatePatchedProposal(
      envelope.proposals[0],
      envelope,
      params.approvalId,
    );
    if (denied) {
      await this.updateWorkTraceApproval(workUnitId, {
        approvalId: params.approvalId,
        approvalOutcome: "rejected",
        approvalRespondedBy: params.respondedBy,
        approvalRespondedAt: respondedAt,
        outcome: "failed",
        completedAt: respondedAt,
      });
      const updatedEnvelope = envelope
        ? ((await envelopeStore.getById(envelope.id)) ?? envelope)
        : null;
      return { envelope: updatedEnvelope!, approvalState: newState, executionResult: null };
    }

    await envelopeStore.update(envelope.id, {
      status: "approved",
      proposals: envelope.proposals,
    });
  }

  await this.updateWorkTraceApproval(workUnitId, {
    approvalId: params.approvalId,
    approvalOutcome: "patched",
    approvalRespondedBy: params.respondedBy,
    approvalRespondedAt: respondedAt,
  });

  executionResult = await this.executeAfterApproval(workUnitId);

  await ledger.record({
    eventType: "action.patched",
    actorType: "user",
    actorId: params.respondedBy,
    entityType: "action",
    entityId: approval.request.actionId,
    riskCategory: (approval.request.riskCategory as RiskCategory) ?? "low",
    summary: `Action patched and approved by ${params.respondedBy}`,
    snapshot: { approvalId: params.approvalId, patchValue: params.patchValue },
    envelopeId: workUnitId,
    traceId: trace?.traceId ?? envelope?.traceId,
  });
}
```

Add the private `reEvaluatePatchedProposal` method (ported from `approval-manager.ts:408-509`):

```ts
// Temporary parity shim — inline governance re-evaluation for patched proposals.
// Scope: limited to respondToApproval() patch handling only.
// Post-PR3: evaluate collapsing behind GovernanceGateInterface.reEvaluate().
private async reEvaluatePatchedProposal(
  proposal: ActionEnvelope["proposals"][0],
  envelope: ActionEnvelope,
  approvalId: string,
): Promise<boolean> {
  const { cartridgeRegistry, policyStore, guardrailState } = this.config as PlatformLifecycleConfig & {
    cartridgeRegistry?: CartridgeRegistry;
    policyStore?: PolicyStore;
    guardrailState?: GuardrailState;
  };

  if (!cartridgeRegistry || !policyStore || !proposal) return false;

  const cartridgeId = (proposal.parameters["_cartridgeId"] as string) ?? "";
  const cartridge = cartridgeRegistry.get(cartridgeId);
  if (!cartridge) return false;

  const principalId = (proposal.parameters["_principalId"] as string) ?? "";
  const orgId = (proposal.parameters["_organizationId"] as string) ?? null;

  let riskInput: import("@switchboard/schemas").RiskInput;
  try {
    riskInput = await cartridge.getRiskInput(
      proposal.actionType,
      proposal.parameters,
      { principalId },
    );
  } catch {
    riskInput = {
      baseRisk: "medium",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    };
  }

  const guardrails = cartridge.getGuardrails();
  const policies = await policyStore.listActive({ cartridgeId });

  const evalContext: EvaluationContext = {
    actionType: proposal.actionType,
    parameters: proposal.parameters,
    cartridgeId,
    principalId,
    organizationId: orgId,
    riskCategory: riskInput.baseRisk,
    metadata: { envelopeId: envelope.id },
  };

  const identitySpec = await this.config.identityStore.getSpecByPrincipalId(principalId);
  const overlays = identitySpec
    ? await this.config.identityStore.listOverlaysBySpecId(identitySpec.id)
    : [];
  const resolvedId = identitySpec
    ? resolveIdentity(identitySpec, overlays, { cartridgeId })
    : { roles: [], permissions: [], trustLevel: "supervised" as const };

  const engineContext: PolicyEngineContext = {
    policies,
    guardrails,
    guardrailState: guardrailState ?? {},
    resolvedIdentity: resolvedId,
    riskInput,
  };

  const reEvalTrace = evaluate(proposal as never, evalContext, engineContext);
  if (reEvalTrace.finalDecision === "deny") {
    envelope.status = "denied";
    await this.config.envelopeStore.update(envelope.id, {
      status: "denied",
      proposals: envelope.proposals,
    });
    await this.config.ledger.record({
      eventType: "action.denied",
      actorType: "system",
      actorId: "platform",
      entityType: "action",
      entityId: approvalId,
      riskCategory: reEvalTrace.computedRiskScore.category,
      summary: "Patched parameters denied by policy re-evaluation",
      snapshot: { approvalId, reason: reEvalTrace.explanation },
      envelopeId: envelope.id,
    });
    return true;
  }
  return false;
}
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `pnpm --filter @switchboard/core exec vitest run src/platform/__tests__/platform-lifecycle.test.ts`
Expected: All tests PASS including both re-evaluation parity tests.

- [ ] **Step 6: Run full CI checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: port patched re-evaluation into PlatformLifecycle

Closes the safety gap where patched approval parameters bypassed
governance in the new platform path. Ports inline re-evaluation
from ApprovalManager as a temporary parity shim (2A-i).
EOF
)"
```

### Task 4: Delete plan approval, queue mode, and freeze old path

**Files:**

- Delete: `packages/core/src/orchestrator/plan-approval-manager.ts`
- Delete: `packages/core/src/orchestrator/__tests__/plan-approval-manager.test.ts`
- Modify: `packages/core/src/orchestrator/approval-manager.ts`
- Modify: `packages/core/src/orchestrator/shared-context.ts`
- Modify: `packages/core/src/orchestrator/lifecycle.ts`
- Delete: `apps/api/src/queue/index.ts`
- Modify: `apps/api/src/__tests__/ingress-boundary.test.ts`

- [ ] **Step 1: Delete plan approval files**

```bash
rm packages/core/src/orchestrator/plan-approval-manager.ts
rm packages/core/src/orchestrator/__tests__/plan-approval-manager.test.ts
```

- [ ] **Step 2: Remove respondToPlanApproval from ApprovalManager**

In `packages/core/src/orchestrator/approval-manager.ts`:

- Remove the `import { respondToPlanApproval } from "./plan-approval-manager.js";` line
- Remove the entire `respondToPlanApproval()` method (lines 511-524)

- [ ] **Step 3: Remove queue execution mode from ApprovalManager**

In `approval-manager.ts`, in `handleApprove()` (around lines 289-294), remove:

```ts
      if (this.ctx.executionMode === "queue" && this.ctx.onEnqueue) {
        await this.ctx.onEnqueue(envelope.id);
        return null;
      } else {
```

Replace with just:

```ts
return await executeApproved(envelope.id);
```

Do the same in `handlePatch()` (around lines 400-405).

- [ ] **Step 4: Remove onEnqueue and executionMode from SharedContext**

In `packages/core/src/orchestrator/shared-context.ts`:

- Remove `executionMode: ExecutionMode;` (line 34)
- Remove `onEnqueue: EnqueueCallback | null;` (line 35)
- Remove import of `ExecutionMode` and `EnqueueCallback` from `lifecycle.js`

In `packages/core/src/orchestrator/lifecycle.ts`:

- Remove `executionMode?: ExecutionMode;` from `OrchestratorConfig` (line 43-44)
- Remove `onEnqueue?: EnqueueCallback;` from `OrchestratorConfig` (line 48)
- Remove `executionMode: config.executionMode ?? "inline",` from the constructor ctx (line 110)
- Remove `onEnqueue: config.onEnqueue ?? null,` from the constructor ctx (line 111)
- Remove `respondToPlanApproval` method (lines 162-174)
- Keep the `ExecutionMode` and `EnqueueCallback` type exports if other files still import them — check first with grep. If only SharedContext uses them, delete them too.

- [ ] **Step 5: Delete queue module**

```bash
rm apps/api/src/queue/index.ts
```

If the directory is now empty:

```bash
rmdir apps/api/src/queue
```

- [ ] **Step 6: Add deprecation header to ApprovalManager**

Add at the very top of `approval-manager.ts`, before imports:

```ts
// DEPRECATED: All new approval logic must go in PlatformLifecycle.
// Changes to this file must strictly reduce surface area or support deletion.
```

- [ ] **Step 7: Extend boundary test to block ApprovalManager imports**

In `apps/api/src/__tests__/ingress-boundary.test.ts`, add:

```ts
it("does not import ApprovalManager in any route file", () => {
  for (const file of routeFiles) {
    const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
    expect(source).not.toContain("ApprovalManager");
  }
});
```

- [ ] **Step 8: Fix compilation errors**

Run: `pnpm typecheck`

Fix any remaining references to deleted types/methods. Common fixes:

- `apps/api/src/app.ts` line 315: remove `executionMode` from orchestrator config
- Old tests referencing `onEnqueue`: update test helpers in `packages/core/src/__tests__/` to remove the field
- `packages/core/src/orchestrator/__tests__/helpers.ts`: remove `onEnqueue` from mock context

- [ ] **Step 9: Run full CI checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: delete plan approval, queue mode, freeze old approval path

- Delete plan-approval-manager.ts (zero callers in apps)
- Delete queue/index.ts (never imported by app.ts)
- Remove executionMode/onEnqueue from orchestrator config
- Add deprecation header to ApprovalManager
- Extend boundary test to block ApprovalManager imports in routes
EOF
)"
```

---

## PR: P0a-PR2 — Execution Ownership

### Task 5: Move routingConfig to PlatformLifecycle

**Files:**

- Modify: `packages/core/src/platform/platform-lifecycle.ts`
- Modify: `apps/api/src/routes/actions.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/__tests__/ingress-boundary.test.ts`

- [ ] **Step 1: Write failing test for routingConfig on PlatformLifecycle**

Add to `platform-lifecycle.test.ts`:

```ts
import { DEFAULT_ROUTING_CONFIG } from "../../approval/router.js";

describe("routingConfig ownership", () => {
  it("exposes routingConfig with default", () => {
    const stores = createMockStores();
    const lifecycle = buildLifecycle(stores);
    expect(lifecycle.routingConfig).toEqual(DEFAULT_ROUTING_CONFIG);
  });

  it("accepts custom routingConfig", () => {
    const stores = createMockStores();
    const custom = { ...DEFAULT_ROUTING_CONFIG, defaultExpiryMs: 1000 };
    const lifecycle = new PlatformLifecycle({
      approvalStore: stores.approvalStore as never,
      envelopeStore: stores.envelopeStore as never,
      identityStore: stores.identityStore as never,
      modeRegistry: stores.modeRegistry,
      traceStore: stores.traceStore,
      ledger: stores.ledger,
      routingConfig: custom,
    });
    expect(lifecycle.routingConfig.defaultExpiryMs).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core exec vitest run src/platform/__tests__/platform-lifecycle.test.ts`
Expected: FAIL — `routingConfig` does not exist on PlatformLifecycle.

- [ ] **Step 3: Add routingConfig to PlatformLifecycleConfig and PlatformLifecycle**

In `platform-lifecycle.ts`:

```ts
import { DEFAULT_ROUTING_CONFIG } from "../approval/router.js";
import type { ApprovalRoutingConfig } from "../approval/router.js";

// Add to PlatformLifecycleConfig:
export interface PlatformLifecycleConfig {
  // ... existing fields ...
  routingConfig?: ApprovalRoutingConfig;
}

// Add getter to PlatformLifecycle class:
get routingConfig(): ApprovalRoutingConfig {
  return this.config.routingConfig ?? DEFAULT_ROUTING_CONFIG;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core exec vitest run src/platform/__tests__/platform-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire routingConfig in app.ts and switch actions.ts**

In `apps/api/src/app.ts`, add `routingConfig` to the PlatformLifecycle constructor (around line 432):

```ts
const platformLifecycle = new PlatformLifecycle({
  // ... existing fields ...
  routingConfig: orchestrator.routingConfig, // bridge: read from old, will be standalone after PR3
});
```

In `apps/api/src/routes/actions.ts`, change line 107 from:

```ts
routingConfig: app.orchestrator.routingConfig,
```

to:

```ts
routingConfig: app.platformLifecycle.routingConfig,
```

- [ ] **Step 6: Extend boundary test**

In `ingress-boundary.test.ts`, add to `BLOCKED_METHODS`:

```ts
"orchestrator.routingConfig",
```

- [ ] **Step 7: Add integration test proving no orchestrator dependency**

Add to `platform-lifecycle.test.ts`:

```ts
describe("approval creation integration", () => {
  it("createApprovalForWorkUnit uses platformLifecycle.routingConfig", async () => {
    const stores = createMockStores();
    const custom = { ...DEFAULT_ROUTING_CONFIG, defaultExpiryMs: 5000 };
    const lifecycle = new PlatformLifecycle({
      approvalStore: stores.approvalStore as never,
      envelopeStore: stores.envelopeStore as never,
      identityStore: stores.identityStore as never,
      modeRegistry: stores.modeRegistry,
      traceStore: stores.traceStore,
      ledger: stores.ledger,
      routingConfig: custom,
    });

    // Prove routingConfig is accessible without any orchestrator reference
    expect(lifecycle.routingConfig.defaultExpiryMs).toBe(5000);
    expect(lifecycle.routingConfig).not.toBe(DEFAULT_ROUTING_CONFIG);
  });
});
```

- [ ] **Step 8: Run full CI checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: move routingConfig ownership to PlatformLifecycle

actions.ts now reads routingConfig from platformLifecycle instead
of the old orchestrator. Boundary test blocks regression.
EOF
)"
```

### Task 6: Move notifier off old orchestrator

**Files:**

- Modify: `apps/api/src/routes/approvals.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Add approvalNotifier to app decorations**

In `apps/api/src/app.ts`, after `app.decorate("platformLifecycle", platformLifecycle)`, add:

```ts
app.decorate("approvalNotifier", approvalNotifier ?? null);
```

Add to the Fastify type declarations (wherever `platformLifecycle` is declared):

```ts
approvalNotifier: import("@switchboard/core").ApprovalNotifier | null;
```

- [ ] **Step 2: Update approvals.ts remind route**

In `apps/api/src/routes/approvals.ts`, replace lines 176-179:

```ts
const orch = app.orchestrator as unknown as Record<string, unknown>;
if (orch["approvalNotifier"]) {
  const notifier = orch["approvalNotifier"] as { notify: (n: unknown) => Promise<void> };
  await notifier.notify(notification);
}
```

with:

```ts
if (app.approvalNotifier) {
  await app.approvalNotifier.notify(notification);
}
```

- [ ] **Step 3: Run full CI checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: move approval notifier off old orchestrator

Approval remind route now reads from app.approvalNotifier instead
of casting the old orchestrator. No behavior change.
EOF
)"
```

---

## PR: P0a-PR3 — Deletion

### Task 7: Delete ApprovalManager and old approval machinery

**Files:**

- Delete: `packages/core/src/orchestrator/approval-manager.ts`
- Modify: `packages/core/src/orchestrator/lifecycle.ts`
- Modify: `packages/core/src/orchestrator/shared-context.ts`
- Delete: `packages/core/src/__tests__/orchestrator-approval.test.ts`
- Modify: `apps/chat/src/api-orchestrator-adapter.ts`
- Modify: `apps/api/src/__tests__/ingress-boundary.test.ts`

- [ ] **Step 1: Delete ApprovalManager**

```bash
rm packages/core/src/orchestrator/approval-manager.ts
```

- [ ] **Step 2: Strip approval methods from LifecycleOrchestrator**

In `lifecycle.ts`:

- Remove `import { ApprovalManager } from "./approval-manager.js";`
- Remove `private approvalManager: ApprovalManager;`
- Remove `this.approvalManager = new ApprovalManager(ctx);` from constructor
- Remove `respondToApproval()` method (lines 176-187)
- Remove `executeApproved()` method (lines 202-204) — this was delegating to ExecutionManager, keep ExecutionManager if still needed for non-approval execution
- Keep `simulate()` and `propose()` — they go through ProposePipeline

- [ ] **Step 3: Remove approval-related fields from SharedContext**

In `shared-context.ts`, remove fields that were only used by ApprovalManager:

- `selfApprovalAllowed` — now only in PlatformLifecycleConfig
- `approvalRateLimit` — now only in PlatformLifecycleConfig
- `approvalNotifier` — now on app directly

Check each field: if still used by ProposePipeline or ExecutionManager, keep it. Only remove fields with zero remaining users.

- [ ] **Step 4: Remove respondToApproval from ApiOrchestratorAdapter**

In `apps/chat/src/api-orchestrator-adapter.ts`, remove the `respondToApproval()` method (lines 343-377). The `RuntimeOrchestrator` interface may require it — if so, mark it as a stub that throws:

```ts
async respondToApproval(): Promise<never> {
  throw new Error("Approval responses go through the API server's PlatformLifecycle");
}
```

- [ ] **Step 5: Delete old approval tests**

```bash
rm packages/core/src/__tests__/orchestrator-approval.test.ts
```

Review `packages/core/src/__tests__/orchestrator-auth.test.ts` — if it contains approval-specific tests that are now covered by `platform-lifecycle.test.ts`, remove those sections. Keep non-approval auth tests.

- [ ] **Step 6: Add regression guard**

In `ingress-boundary.test.ts`, add:

```ts
it("ApprovalManager does not exist", () => {
  const approvalManagerPath = resolve(
    import.meta.dirname,
    "../../../../packages/core/src/orchestrator/approval-manager.ts",
  );
  expect(() => readFileSync(approvalManagerPath)).toThrow();
});

it("no file references LifecycleOrchestrator approval methods", () => {
  // Scan all non-test ts files in apps/ and packages/
  const { execSync } = require("node:child_process");
  const result = execSync(
    'grep -r "orchestrator\\.respondToApproval\\|orchestrator\\.executeApproved\\|orchestrator\\.routingConfig" apps/ packages/ --include="*.ts" -l || true',
    { encoding: "utf-8" },
  ).trim();
  const files = result
    .split("\n")
    .filter(
      (f) =>
        f && !f.includes("__tests__") && !f.includes(".test.") && !f.includes("ingress-boundary"),
    );
  expect(files).toEqual([]);
});
```

- [ ] **Step 7: Fix compilation errors and update exports**

Run: `pnpm typecheck`

Fix any remaining imports. Update `packages/core/src/orchestrator/index.ts` to remove ApprovalManager export. Update `packages/core/src/index.ts` if it re-exports approval types.

- [ ] **Step 8: Run full CI checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: delete ApprovalManager — one approval owner

PlatformLifecycle is now the sole approval owner. ApprovalManager
deleted. Old orchestrator stripped to simulate() only.
Regression guard prevents reintroduction.
EOF
)"
```

---

## PR: P0c — Chat Legacy Deletion

### Task 8: Delete dead single-tenant chat code

**Files:**

- Delete: `apps/chat/src/runtime.ts`
- Delete: `apps/chat/src/bootstrap.ts`
- Delete: `apps/chat/src/managed-runtime.ts`
- Delete: `apps/chat/src/api-orchestrator-adapter.ts`
- Delete: `apps/chat/src/message-pipeline.ts`
- Delete: `apps/chat/src/runtime-helpers.ts`
- Delete: `apps/chat/src/handlers/` (entire directory)
- Delete: `apps/chat/src/middleware/dialogue-middleware.ts`
- Delete: `apps/chat/src/composer/` (entire directory)
- Delete: `apps/chat/src/conversation/llm-conversation-engine.ts`
- Delete: `apps/chat/src/__tests__/runtime-integration.test.ts`
- Delete: `apps/chat/src/__tests__/kill-switch.test.ts`
- Delete: `apps/chat/src/__tests__/crm-auto-create.test.ts`
- Delete: `apps/chat/src/__tests__/cockpit-commands.test.ts`
- Delete: `apps/chat/src/__tests__/api-orchestrator-retry.test.ts`
- Delete: `apps/chat/src/__tests__/humanize.test.ts`
- Delete: `apps/chat/src/conversation/__tests__/llm-conversation-engine.test.ts`

- [ ] **Step 1: Verify reachability before deleting**

Run this check to confirm none of the deletion targets are imported by `main.ts`, `gateway-bridge.ts`, or any gateway file:

```bash
grep -r "from.*\./runtime\|from.*\./bootstrap\|from.*\./managed-runtime\|from.*\./api-orchestrator-adapter\|from.*\./message-pipeline\|from.*\./runtime-helpers" apps/chat/src/main.ts apps/chat/src/gateway/ 2>/dev/null || echo "No imports found — safe to delete"
```

Expected: "No imports found — safe to delete"

- [ ] **Step 2: Delete source files**

```bash
rm apps/chat/src/runtime.ts
rm apps/chat/src/bootstrap.ts
rm apps/chat/src/managed-runtime.ts
rm apps/chat/src/api-orchestrator-adapter.ts
rm apps/chat/src/message-pipeline.ts
rm apps/chat/src/runtime-helpers.ts
rm -rf apps/chat/src/handlers/
rm apps/chat/src/middleware/dialogue-middleware.ts
rm -rf apps/chat/src/composer/
rm apps/chat/src/conversation/llm-conversation-engine.ts
```

- [ ] **Step 3: Delete dead tests**

```bash
rm apps/chat/src/__tests__/runtime-integration.test.ts
rm apps/chat/src/__tests__/kill-switch.test.ts
rm apps/chat/src/__tests__/crm-auto-create.test.ts
rm apps/chat/src/__tests__/cockpit-commands.test.ts
rm apps/chat/src/__tests__/api-orchestrator-retry.test.ts
rm apps/chat/src/__tests__/humanize.test.ts
rm apps/chat/src/conversation/__tests__/llm-conversation-engine.test.ts
```

- [ ] **Step 4: Fix compilation errors**

Run: `pnpm typecheck`

Common fixes:

- Remove stale re-exports from any index.ts files in `apps/chat/src/`
- Check if `apps/chat/src/__tests__/chat.test.ts` imports anything from deleted files — if so, update or delete those imports
- Check `apps/chat/src/__tests__/whatsapp-compliance.test.ts` — this one stays but may need updating if it imported ChatRuntime

- [ ] **Step 5: Run full CI checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: delete dead single-tenant chat runtime (~2300 lines)

ChatRuntime, ApiOrchestratorAdapter, bootstrap.ts, managed-runtime.ts,
message-pipeline, handlers/, composer/, and associated tests deleted.
All chat paths now use ChannelGateway + PlatformIngress.
EOF
)"
```

### Task 9: Rewrite WhatsApp compliance test + add regression guard

**Files:**

- Modify or recreate: `apps/chat/src/__tests__/whatsapp-compliance.test.ts`
- Create: `apps/chat/src/__tests__/chat-legacy-guard.test.ts`

- [ ] **Step 1: Rewrite WhatsApp compliance test**

If the current test depended on ChatRuntime, rewrite it to test the WhatsApp adapter's 24h window enforcement directly:

```ts
// apps/chat/src/__tests__/whatsapp-compliance.test.ts
import { describe, it, expect } from "vitest";
import { isWithinWhatsAppWindow } from "../adapters/whatsapp.js";

describe("WhatsApp 24h compliance", () => {
  it("allows messages within 24h window", () => {
    const lastInbound = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12h ago
    expect(isWithinWhatsAppWindow(lastInbound)).toBe(true);
  });

  it("rejects messages outside 24h window", () => {
    const lastInbound = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
    expect(isWithinWhatsAppWindow(lastInbound)).toBe(false);
  });

  it("rejects when no inbound timestamp exists", () => {
    expect(isWithinWhatsAppWindow(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Add regression guard**

```ts
// apps/chat/src/__tests__/chat-legacy-guard.test.ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SRC_DIR = resolve(import.meta.dirname, "..");

const DELETED_MODULES = [
  "runtime.ts",
  "bootstrap.ts",
  "managed-runtime.ts",
  "api-orchestrator-adapter.ts",
  "message-pipeline.ts",
];

describe("chat legacy guard", () => {
  for (const mod of DELETED_MODULES) {
    it(`${mod} does not exist`, () => {
      expect(existsSync(resolve(SRC_DIR, mod))).toBe(false);
    });
  }

  it("no source file imports deleted modules", () => {
    const tsFiles = readdirSync(SRC_DIR, { recursive: true }).filter(
      (f): f is string =>
        typeof f === "string" &&
        f.endsWith(".ts") &&
        !f.includes("__tests__") &&
        !f.includes("node_modules"),
    );

    const patterns = [
      /from\s+["']\.\/runtime/,
      /from\s+["']\.\/bootstrap/,
      /from\s+["']\.\/managed-runtime/,
      /from\s+["']\.\/api-orchestrator-adapter/,
      /from\s+["']\.\/message-pipeline/,
    ];

    for (const file of tsFiles) {
      const content = readFileSync(resolve(SRC_DIR, file), "utf-8");
      for (const pattern of patterns) {
        expect(content, `${file} imports deleted module matching ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @switchboard/chat exec vitest run`
Expected: All pass including new WhatsApp test and guard.

- [ ] **Step 4: Run full CI checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
test: rewrite WhatsApp compliance test, add chat legacy guard

WhatsApp 24h window test now tests the adapter directly.
Regression guard prevents reintroduction of deleted modules.
EOF
)"
```
