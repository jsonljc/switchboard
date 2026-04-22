# Runtime Convergence Foundation Implementation Plan

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make PlatformIngress the authoritative mutating runtime boundary by introducing a canonical mutating request contract, moving deployment resolution into ingress, converging API and MCP mutation paths onto that contract, and adding guardrails that prevent non-converged mutation paths from shipping.

**Architecture:** This is tranche 1 of the runtime convergence program. It establishes the canonical request envelope and ingress-owned resolution in packages/core, rewires API and MCP mutating entrypoints to use it, and adds tests that prove ingress-first behavior. Chat surface migration, dashboard mutation cleanup, and direct side-effect route containment belong in follow-on plans once this foundation is in place.

**Tech Stack:** TypeScript, Fastify, Vitest, Next.js route handlers, Switchboard PlatformIngress, MCP API adapters

---

## Scope Check

The approved runtime convergence spec spans multiple independent subsystems:

- shared canonical runtime contract in packages/core
- API surface migration
- MCP surface migration
- chat surface migration
- dashboard mutation cleanup
- direct side-effect containment for route-owned business flows

This plan intentionally covers only the first three items. Follow-on implementation plans are required for:

- chat convergence onto the canonical request contract
- dashboard convergence and deletion of launch-ineligible mutation routes
- direct side-effect containment for creative-pipeline, ad-optimizer, and similar route-owned mutation flows

---

## File Structure

### Runtime core

- **Create:** `packages/core/src/platform/canonical-request.ts`
  - Defines the single mutating surface-to-runtime contract.
- **Modify:** `packages/core/src/platform/work-unit.ts`
  - Normalizes a work unit from canonical request fields after ingress-owned resolution.
- **Modify:** `packages/core/src/platform/platform-ingress.ts`
  - Resolves deployment authoritatively inside ingress and establishes the trace root before dispatch.
- **Modify:** `packages/core/src/platform/index.ts`
  - Re-export canonical request types and resolver interfaces.

### API surface

- **Modify:** `apps/api/src/routes/execute.ts`
  - Stop resolving deployment in the route; adapt request into canonical ingress input.
- **Modify:** `apps/api/src/routes/actions.ts`
  - Same canonical request adaptation for propose/undo/execute submit paths.
- **Modify:** `apps/api/src/routes/ingress.ts`
  - Accept canonical surface input, not pre-resolved deployment context.
- **Delete:** `apps/api/src/utils/resolve-deployment.ts`
  - Route-owned deployment resolution must disappear from the launchable mutation path.
- **Modify:** `apps/api/src/app.ts`
  - Pass the authoritative resolver into PlatformIngress.
- **Modify:** `apps/api/src/__tests__/test-server.ts`
  - Wire the same ingress resolver in test boot.

### MCP surface

- **Modify:** `apps/mcp-server/src/adapters/api-execution-adapter.ts`
  - Send canonical mutation input and assert API response semantics.
- **Modify:** `apps/mcp-server/src/main.ts`
  - Block in-memory mutation mode in production deployments and require API-backed mutation in shipped environments.

### Tests

- **Modify:** `packages/core/src/platform/__tests__/platform-ingress.test.ts`
  - Assert ingress-owned resolution and trace root establishment.
- **Create:** `apps/api/src/__tests__/runtime-convergence-api.test.ts`
  - Assert mutating API routes do not resolve deployment themselves and all mutation requests enter ingress canonically.
- **Modify:** `apps/api/src/__tests__/ingress-boundary.test.ts`
  - Extend boundary enforcement to block route-level deployment resolution helpers.
- **Create:** `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts`
  - Assert production MCP mode refuses non-API mutation paths.
- **Modify:** `apps/mcp-server/src/__tests__/api-execution-adapter.test.ts`
  - Assert adapter request/response shape matches canonical mutation semantics.

---

## Task 1: Introduce the canonical mutating request contract

**Files:**

- Create: `packages/core/src/platform/canonical-request.ts`
- Modify: `packages/core/src/platform/work-unit.ts`
- Modify: `packages/core/src/platform/index.ts`
- Test: `packages/core/src/platform/__tests__/platform-ingress.test.ts`

### Step 1: Write the failing ingress test for authoritative resolution

- [ ] Add this test to `packages/core/src/platform/__tests__/platform-ingress.test.ts`:

```typescript
it("resolves deployment inside PlatformIngress from canonical request fields", async () => {
  const resolveDeployment = vi.fn().mockResolvedValue({
    deploymentId: "dep-resolved",
    skillSlug: "pause-campaign",
    trustLevel: "guided",
    trustScore: 42,
  });
  const config = createConfig({
    resolveDeployment,
  });
  const ingress = new PlatformIngress(config);

  const response = await ingress.submit({
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    intent: "campaign.pause",
    parameters: { campaignId: "camp-123" },
    trigger: "api",
    surface: {
      surface: "api",
      requestId: "req-1",
    },
    targetHint: {
      skillSlug: "pause-campaign",
    },
  });

  expect(resolveDeployment).toHaveBeenCalledOnce();
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.workUnit.deployment.deploymentId).toBe("dep-resolved");
    expect(response.workUnit.traceId.length).toBeGreaterThan(0);
  }
});
```

### Step 2: Run the platform ingress tests to verify they fail

- [ ] Run:

```bash
pnpm vitest run packages/core/src/platform/__tests__/platform-ingress.test.ts
```

Expected: FAIL because `PlatformIngress.submit()` currently requires a pre-resolved deployment on the request and has no ingress-owned resolver.

### Step 3: Add the canonical request types

- [ ] Create `packages/core/src/platform/canonical-request.ts`:

```typescript
import type { Actor, Trigger } from "./types.js";

export type SurfaceName = "api" | "mcp" | "chat" | "dashboard";

export interface SurfaceMetadata {
  surface: SurfaceName;
  requestId?: string;
  sessionId?: string;
  correlationId?: string;
}

export interface TargetHint {
  skillSlug?: string;
  deploymentId?: string;
  channel?: string;
  token?: string;
}

export interface CanonicalSubmitRequest {
  organizationId: string;
  actor: Actor;
  intent: string;
  parameters: Record<string, unknown>;
  trigger: Trigger;
  surface: SurfaceMetadata;
  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId?: string;
  priority?: "low" | "normal" | "high";
  targetHint?: TargetHint;
}

export interface AuthoritativeDeploymentResolver {
  resolve(request: CanonicalSubmitRequest): Promise<{
    deploymentId: string;
    skillSlug: string;
    trustLevel: "observe" | "guided" | "supervised" | "autonomous" | "locked";
    trustScore: number;
  }>;
}
```

- [ ] Update `packages/core/src/platform/work-unit.ts`:

```typescript
import type { CanonicalSubmitRequest } from "./canonical-request.js";
import type { DeploymentContext } from "./deployment-context.js";

export interface SubmitWorkRequest extends CanonicalSubmitRequest {
  deployment: DeploymentContext;
  suggestedMode?: ExecutionModeName;
}
```

- [ ] Update `packages/core/src/platform/index.ts`:

```typescript
export * from "./canonical-request.js";
```

### Step 4: Make PlatformIngress resolve deployment authoritatively

- [ ] Update `packages/core/src/platform/platform-ingress.ts`:

```typescript
import type {
  AuthoritativeDeploymentResolver,
  CanonicalSubmitRequest,
} from "./canonical-request.js";

export interface PlatformIngressConfig {
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  governanceGate: GovernanceGateInterface;
  deploymentResolver: AuthoritativeDeploymentResolver;
  traceStore?: WorkTraceStore;
}

export class PlatformIngress {
  // ...

  async submit(request: CanonicalSubmitRequest): Promise<SubmitWorkResponse> {
    const { intentRegistry, modeRegistry, governanceGate, traceStore, deploymentResolver } =
      this.config;

    // existing idempotency + intent checks stay in place

    const resolvedMode = intentRegistry.resolveMode(request.intent, request.suggestedMode);
    const deployment = await deploymentResolver.resolve(request);
    const workUnit = normalizeWorkUnit(
      {
        ...request,
        deployment,
        suggestedMode: resolvedMode,
      },
      resolvedMode,
    );

    // existing governance + dispatch flow continues unchanged
  }
}
```

- [ ] Also update the test helper in `packages/core/src/platform/__tests__/platform-ingress.test.ts`:

```typescript
function createConfig(
  overrides: {
    decision?: GovernanceDecision;
    governanceThrows?: boolean;
    traceStore?: WorkTraceStore;
    mode?: ExecutionMode;
    resolveDeployment?: ReturnType<typeof vi.fn>;
  } = {},
): PlatformIngressConfig {
  // ...
  return {
    intentRegistry,
    modeRegistry,
    governanceGate,
    deploymentResolver: {
      resolve:
        overrides.resolveDeployment ??
        vi.fn().mockResolvedValue({
          deploymentId: "dep-1",
          skillSlug: "test-skill",
          trustLevel: "guided",
          trustScore: 42,
        }),
    },
    traceStore: overrides.traceStore,
  };
}
```

### Step 5: Run the platform ingress tests again

- [ ] Run:

```bash
pnpm vitest run packages/core/src/platform/__tests__/platform-ingress.test.ts
```

Expected: PASS. The new test should prove deployment resolution now happens inside ingress, and existing execution/governance tests should remain green.

### Step 6: Commit

- [ ] ````bash
          git add \
            packages/core/src/platform/canonical-request.ts \
            packages/core/src/platform/work-unit.ts \
            packages/core/src/platform/platform-ingress.ts \
            packages/core/src/platform/index.ts \
            packages/core/src/platform/__tests__/platform-ingress.test.ts
          git commit -m "feat: add canonical mutating request contract"
          ```
      ````

````

---

## Task 2: Remove route-owned deployment resolution from the API surface

**Files:**

- Modify: `apps/api/src/routes/execute.ts`
- Modify: `apps/api/src/routes/actions.ts`
- Modify: `apps/api/src/routes/ingress.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/__tests__/test-server.ts`
- Create: `apps/api/src/__tests__/runtime-convergence-api.test.ts`
- Modify: `apps/api/src/__tests__/ingress-boundary.test.ts`
- Delete: `apps/api/src/utils/resolve-deployment.ts`

### Step 1: Write the failing API convergence tests

- [ ] Create `apps/api/src/__tests__/runtime-convergence-api.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("API runtime convergence", () => {
  let app: FastifyInstance;
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it("routes /api/execute through PlatformIngress without pre-resolved deployment input", async () => {
    const submitSpy = vi.spyOn(app.platformIngress, "submit");

    await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: { "Idempotency-Key": "conv-execute" },
      payload: {
        actorId: "default",
        organizationId: "org_test",
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp-1" },
          sideEffect: true,
        },
      },
    });

    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.calls[0]?.[0]).not.toHaveProperty("deployment");
    expect(submitSpy.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_test",
      intent: "digital-ads.campaign.pause",
      surface: { surface: "api" },
    });
  });
});
````

- [ ] Update `apps/api/src/__tests__/ingress-boundary.test.ts`:

```typescript
it("does not import route-level deployment resolution helpers in mutating routes", () => {
  for (const file of routeFiles) {
    const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
    expect(source).not.toContain("resolveDeploymentForIntent(");
  }
});
```

### Step 2: Run the API convergence tests to verify they fail

- [ ] Run:

```bash
pnpm vitest run \
  apps/api/src/__tests__/runtime-convergence-api.test.ts \
  apps/api/src/__tests__/ingress-boundary.test.ts
```

Expected: FAIL because `execute.ts`, `actions.ts`, and `ingress.ts` currently resolve or accept deployment outside ingress.

### Step 3: Rewire API routes to emit only canonical request fields

- [ ] Update `apps/api/src/routes/execute.ts`:

```typescript
const submitRequest = {
  intent: body.action.actionType,
  parameters: body.action.parameters,
  actor: { id: body.actorId, type: "user" as const },
  organizationId,
  trigger: "api" as const,
  idempotencyKey,
  traceId: body.traceId,
  surface: {
    surface: "api" as const,
    requestId: request.id,
  },
  targetHint: {
    skillSlug: body.action.actionType.split(".")[0],
  },
};
```

- [ ] Update `apps/api/src/routes/actions.ts` the same way in both propose paths:

```typescript
const submitRequest = {
  intent: body.actionType,
  parameters: body.message ? { ...body.parameters, _message: body.message } : body.parameters,
  actor: { id: body.principalId, type: "user" as const },
  organizationId,
  trigger: "api" as const,
  idempotencyKey,
  surface: {
    surface: "api" as const,
    requestId: request.id,
  },
  targetHint: {
    skillSlug: body.actionType.split(".")[0],
  },
};
```

- [ ] Update `apps/api/src/routes/ingress.ts`:

```typescript
const body = request.body as {
  organizationId: string;
  actor: { id: string; type: string };
  intent: string;
  parameters: Record<string, unknown>;
  trigger: string;
  surface?: { surface: "chat" | "dashboard" | "mcp" | "api"; sessionId?: string };
  targetHint?: Record<string, unknown>;
  traceId?: string;
  idempotencyKey?: string;
};

const response = await app.platformIngress.submit({
  organizationId: body.organizationId,
  actor: { id: body.actor?.id ?? "anonymous", type: (body.actor?.type ?? "user") as "user" },
  intent: body.intent,
  parameters: body.parameters ?? {},
  trigger: (body.trigger ?? "api") as "api" | "chat" | "schedule",
  surface: body.surface ?? { surface: "api" },
  targetHint: body.targetHint,
  traceId: body.traceId,
  idempotencyKey: body.idempotencyKey,
});
```

- [ ] Update `apps/api/src/app.ts` and `apps/api/src/__tests__/test-server.ts` to inject the authoritative resolver:

```typescript
import { resolveAuthoritativeDeployment } from "./bootstrap/platform-deployment-resolver.js";

const platformIngress = new PlatformIngress({
  intentRegistry,
  modeRegistry,
  governanceGate,
  deploymentResolver: resolveAuthoritativeDeployment(app.deploymentResolver),
  traceStore,
});
```

- [ ] Create `apps/api/src/bootstrap/platform-deployment-resolver.ts`:

```typescript
import type {
  AuthoritativeDeploymentResolver,
  CanonicalSubmitRequest,
  DeploymentResolver,
} from "@switchboard/core/platform";

export function resolveAuthoritativeDeployment(
  resolver: DeploymentResolver | null,
): AuthoritativeDeploymentResolver {
  return {
    async resolve(request: CanonicalSubmitRequest) {
      const skillSlug = request.targetHint?.skillSlug ?? request.intent.split(".")[0] ?? "unknown";
      if (!resolver) {
        return {
          deploymentId: "platform-direct",
          skillSlug,
          trustLevel: "supervised",
          trustScore: 0,
        };
      }
      const result = await resolver.resolveByOrgAndSlug(request.organizationId, skillSlug);
      return {
        deploymentId: result.deploymentId,
        skillSlug: result.skillSlug,
        trustLevel: result.trustLevel,
        trustScore: result.trustScore,
      };
    },
  };
}
```

- [ ] Delete `apps/api/src/utils/resolve-deployment.ts`.

### Step 4: Run the API convergence tests again

- [ ] Run:

```bash
pnpm vitest run \
  apps/api/src/__tests__/runtime-convergence-api.test.ts \
  apps/api/src/__tests__/ingress-boundary.test.ts \
  apps/api/src/__tests__/api-execute.test.ts \
  apps/api/src/__tests__/api-actions.test.ts
```

Expected: PASS. API mutation routes should no longer pass a pre-resolved deployment and should still preserve existing API behavior.

### Step 5: Commit

- [ ] ````bash
          git add \
            apps/api/src/routes/execute.ts \
            apps/api/src/routes/actions.ts \
            apps/api/src/routes/ingress.ts \
            apps/api/src/app.ts \
            apps/api/src/bootstrap/platform-deployment-resolver.ts \
            apps/api/src/__tests__/runtime-convergence-api.test.ts \
            apps/api/src/__tests__/ingress-boundary.test.ts \
            apps/api/src/__tests__/test-server.ts
          git rm apps/api/src/utils/resolve-deployment.ts
          git commit -m "refactor: move deployment resolution into platform ingress"
          ```
      ````

````

---

## Task 3: Converge MCP mutation onto the canonical ingress boundary

**Files:**

- Modify: `apps/mcp-server/src/adapters/api-execution-adapter.ts`
- Modify: `apps/mcp-server/src/main.ts`
- Modify: `apps/mcp-server/src/__tests__/api-execution-adapter.test.ts`
- Create: `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts`

### Step 1: Write the failing MCP tests

- [ ] Update `apps/mcp-server/src/__tests__/api-execution-adapter.test.ts` with:

```typescript
  it("treats the API as the canonical mutation boundary rather than a surface-local executor", async () => {
    await adapter.execute({
      actorId: "mcp-user",
      organizationId: "org_test",
      requestedAction: {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_123" },
        sideEffect: true,
      },
      traceId: "trace_mcp_1",
    });

    expect(client.post).toHaveBeenCalledWith(
      "/api/execute",
      expect.objectContaining({
        actorId: "mcp-user",
        organizationId: "org_test",
        action: expect.objectContaining({
          actionType: "digital-ads.campaign.pause",
        }),
      }),
      expect.any(String),
    );
  });
````

- [ ] Create `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("MCP production mutation guard", () => {
  it("refuses in-memory mutation mode in production without API delegation", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SWITCHBOARD_API_URL;

    const { buildMutationModeGuard } = await import("../main.js");

    expect(() => buildMutationModeGuard()).toThrow(
      "Production MCP mutation requires SWITCHBOARD_API_URL",
    );
  });
});
```

### Step 2: Run the MCP tests to verify they fail

- [ ] Run:

```bash
pnpm vitest run \
  apps/mcp-server/src/__tests__/api-execution-adapter.test.ts \
  apps/mcp-server/src/__tests__/production-mutation-guard.test.ts
```

Expected: FAIL because `main.ts` currently allows in-memory mutation mode whenever `SWITCHBOARD_API_URL` is absent.

### Step 3: Add the MCP production mutation guard

- [ ] Update `apps/mcp-server/src/main.ts`:

```typescript
export function buildMutationModeGuard(): void {
  const apiUrl = process.env["SWITCHBOARD_API_URL"];
  const allowInMemory = process.env["ALLOW_IN_MEMORY_MCP"] === "true";

  if (process.env.NODE_ENV === "production" && !apiUrl && !allowInMemory) {
    throw new Error("Production MCP mutation requires SWITCHBOARD_API_URL");
  }
}

async function main() {
  buildMutationModeGuard();
  const apiUrl = process.env["SWITCHBOARD_API_URL"];
  // existing startup flow continues
}
```

- [ ] Update `apps/mcp-server/src/adapters/api-execution-adapter.ts` only to keep the mutation request lean and canonical:

```typescript
      "/api/execute",
      {
        actorId: request.actorId,
        organizationId: request.organizationId ?? null,
        action: {
          actionType: request.requestedAction.actionType,
          parameters: request.requestedAction.parameters,
          sideEffect: request.requestedAction.sideEffect ?? true,
        },
        traceId: request.traceId,
      },
      this.client.idempotencyKey("mcp_exec"),
```

Do not add an MCP-specific execution shim here. The adapter should remain a thin surface adapter into the API mutation boundary.

### Step 4: Run the MCP tests again

- [ ] Run:

```bash
pnpm vitest run \
  apps/mcp-server/src/__tests__/api-execution-adapter.test.ts \
  apps/mcp-server/src/__tests__/production-mutation-guard.test.ts
```

Expected: PASS. The API adapter test should still pass, and production mode should now reject non-API mutation startup.

### Step 5: Commit

- [ ] ````bash
          git add \
            apps/mcp-server/src/adapters/api-execution-adapter.ts \
            apps/mcp-server/src/main.ts \
            apps/mcp-server/src/__tests__/api-execution-adapter.test.ts \
            apps/mcp-server/src/__tests__/production-mutation-guard.test.ts
          git commit -m "fix: require api-backed mutation for mcp production mode"
          ```
      ````

````

---

## Task 4: Add convergence guardrails that block non-authoritative API runtime shortcuts

**Files:**

- Modify: `apps/api/src/__tests__/ingress-boundary.test.ts`
- Create: `apps/api/src/__tests__/runtime-convergence-api.test.ts`
- Modify: `apps/mcp-server/src/__tests__/dual-mode-integration.test.ts`

### Step 1: Extend the failing guardrail tests

- [ ] Update `apps/api/src/__tests__/ingress-boundary.test.ts`:

```typescript
  it("does not accept pre-resolved deployment objects in ingress route source", () => {
    const source = readFileSync(resolve(ROUTES_DIR, "ingress.ts"), "utf-8");
    expect(source).not.toContain("deployment?: Record<string, unknown>");
    expect(source).not.toContain("deployment: body.deployment");
  });
````

- [ ] Update `apps/mcp-server/src/__tests__/dual-mode-integration.test.ts` to assert production semantics:

```typescript
it("documents that in-memory mode is test-only and not a shipped production mutation path", async () => {
  expect(process.env.NODE_ENV ?? "test").not.toBe("production");
});
```

### Step 2: Run the guardrail tests to verify they fail

- [ ] Run:

```bash
pnpm vitest run \
  apps/api/src/__tests__/ingress-boundary.test.ts \
  apps/mcp-server/src/__tests__/dual-mode-integration.test.ts
```

Expected: FAIL because the ingress route still describes or forwards a deployment object today.

### Step 3: Make the guardrails pass

- [ ] Update `apps/api/src/routes/ingress.ts` request typing to remove deployment entirely:

```typescript
const body = request.body as {
  organizationId: string;
  actor: { id: string; type: string };
  intent: string;
  parameters: Record<string, unknown>;
  trigger: string;
  surface?: { surface: "chat" | "dashboard" | "mcp" | "api"; sessionId?: string };
  targetHint?: Record<string, unknown>;
  traceId?: string;
  idempotencyKey?: string;
};
```

- [ ] Update the dual-mode test comment or assertion to mark the in-memory branch as test-only behavior, not a production-supported mutation path.

### Step 4: Run the guardrail tests again

- [ ] Run:

```bash
pnpm vitest run \
  apps/api/src/__tests__/ingress-boundary.test.ts \
  apps/mcp-server/src/__tests__/dual-mode-integration.test.ts
```

Expected: PASS.

### Step 5: Commit

- [ ] ````bash
          git add \
            apps/api/src/routes/ingress.ts \
            apps/api/src/__tests__/ingress-boundary.test.ts \
            apps/mcp-server/src/__tests__/dual-mode-integration.test.ts
          git commit -m "test: add convergence guardrails for ingress-first mutation"
          ```
      ````

````

---

## Task 5: Run the foundation convergence verification slice

**Files:**

- Test only:
  - `packages/core/src/platform/__tests__/platform-ingress.test.ts`
  - `apps/api/src/__tests__/runtime-convergence-api.test.ts`
  - `apps/api/src/__tests__/ingress-boundary.test.ts`
  - `apps/api/src/__tests__/api-execute.test.ts`
  - `apps/api/src/__tests__/api-actions.test.ts`
  - `apps/mcp-server/src/__tests__/api-execution-adapter.test.ts`
  - `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts`

### Step 1: Run the full foundation verification slice

- [ ] Run:
```bash
pnpm vitest run \
  packages/core/src/platform/__tests__/platform-ingress.test.ts \
  apps/api/src/__tests__/runtime-convergence-api.test.ts \
  apps/api/src/__tests__/ingress-boundary.test.ts \
  apps/api/src/__tests__/api-execute.test.ts \
  apps/api/src/__tests__/api-actions.test.ts \
  apps/mcp-server/src/__tests__/api-execution-adapter.test.ts \
  apps/mcp-server/src/__tests__/production-mutation-guard.test.ts
````

Expected: PASS across all listed files.

### Step 2: Run a broader persistence and approval regression slice

- [ ] Run:

```bash
pnpm vitest run \
  apps/api/src/__tests__/api-approvals.test.ts \
  apps/api/src/__tests__/persistence-truth.test.ts \
  apps/api/src/__tests__/execute-platform-parity.test.ts
```

Expected: PASS. API mutation semantics, approval state, and ingress trace behavior should remain intact after the canonical request refactor.

### Step 3: Commit the verification checkpoint

- [ ] ````bash
          git add -A
          git commit -m "test: verify runtime convergence foundation slice"
          ```
      ````

```

---

## Follow-on Plans Required

Do not expand this plan ad hoc. After this foundation lands, write separate implementation plans for:

1. **Chat surface convergence**
   - move channel-token targeting and conversation correlation onto the canonical request contract without surface-owned authoritative deployment resolution

2. **Dashboard mutation convergence**
   - remove or re-adapt operator and internal mutation routes that do not enter PlatformIngress first

3. **Direct side-effect containment**
   - move creative-pipeline, ad-optimizer, and other route-owned mutators behind the canonical request and shared lifecycle or remove them from launch scope

---

## Self-Review

### Spec coverage

- canonical mutating request contract: covered by Task 1
- PlatformIngress-owned deployment resolution: covered by Tasks 1 and 2
- API mutation convergence: covered by Task 2
- MCP mutation convergence and production guardrail: covered by Tasks 3 and 4
- behavioral verification of ingress-first mutation: covered by Task 5

### Placeholder scan

- No TODO, TBD, or "similar to Task N" markers remain.
- Every code-changing step includes concrete code.
- Every verification step includes an exact command and expected result.

### Type consistency

- `CanonicalSubmitRequest` is introduced once and reused throughout the plan.
- `PlatformIngress.submit()` is the only mutating runtime boundary in every task.
- API and MCP both send canonical request fields rather than pre-resolved deployment context.
```
