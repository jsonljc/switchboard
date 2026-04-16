# Platform Convergence Phase 4 — Migrate Cartridge Path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cartridge actions enter through the platform contract via CartridgeMode, which wraps the existing LifecycleOrchestrator.

**Architecture:** CartridgeMode wraps the full LifecycleOrchestrator (not just the ExecutionManager). The orchestrator already handles context enrichment, entity resolution, policy evaluation, approval routing, and execution as an integrated pipeline. Splitting that apart would be reckless. Instead, CartridgeMode calls `orchestrator.propose()` internally and maps `ProposeResult` → `ExecutionResult`. Cartridge actions auto-register as intents from cartridge manifests at boot.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-platform-convergence-design.md` (Phase 4)

---

## Key Design Decision: Wrap the Orchestrator, Not Just the ExecutionManager

The spec says "CartridgeMode wraps existing ExecutionManager." But the actual `ExecutionManager` is deeply coupled to `SharedContext`, envelope persistence, cartridge lookup, and the approval state machine. It cannot be called standalone without the full orchestrator context.

The pragmatic approach: CartridgeMode wraps `LifecycleOrchestrator.propose()`. This:

- Preserves all existing cartridge behavior (enrichment, resolution, approval routing)
- Avoids ripping apart the orchestrator's internal pipeline
- Maps the orchestrator's `ProposeResult` to the platform's `ExecutionResult`
- Makes the orchestrator an _internal engine_ of CartridgeMode, not the platform entry point

This is the spec's intent ("Execution guard is unchanged — it's a good engine") applied correctly.

---

## File Map

| File                                                                      | Action | Responsibility                                            |
| ------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `packages/core/src/platform/modes/cartridge-mode.ts`                      | Create | ExecutionMode wrapping LifecycleOrchestrator              |
| `packages/core/src/platform/cartridge-intent-registrar.ts`                | Create | Auto-register cartridge actions as intents from manifests |
| `packages/core/src/platform/modes/index.ts`                               | Modify | Add CartridgeMode export                                  |
| `packages/core/src/platform/index.ts`                                     | Modify | Add cartridge registrar export                            |
| `packages/core/src/platform/__tests__/cartridge-mode.test.ts`             | Create | CartridgeMode unit tests                                  |
| `packages/core/src/platform/__tests__/cartridge-intent-registrar.test.ts` | Create | Auto-registration tests                                   |

---

## Task 1: Build CartridgeMode

**Files:**

- Create: `packages/core/src/platform/modes/cartridge-mode.ts`
- Create: `packages/core/src/platform/__tests__/cartridge-mode.test.ts`

- [ ] **Step 1: Read actual types first**

Read these files to understand the interfaces:

- `packages/core/src/orchestrator/lifecycle.ts` — `LifecycleOrchestrator`, `ProposeResult`, `propose()` params
- `packages/core/src/platform/execution-context.ts` — `ExecutionMode` interface
- `packages/core/src/platform/governance-types.ts` — `ExecutionConstraints`
- `packages/core/src/platform/execution-result.ts` — `ExecutionResult`
- `packages/core/src/platform/work-unit.ts` — `WorkUnit`

- [ ] **Step 2: Write the test**

Test cases:

1. "calls orchestrator.propose with mapped params and returns completed on allow" — mock orchestrator.propose() to return allow/not denied, verify ExecutionResult.outcome === "completed"
2. "returns pending_approval when orchestrator returns approval request" — mock to return approvalRequest not null, verify outcome === "pending_approval"
3. "returns failed when orchestrator returns denied" — mock to return denied: true, verify outcome === "failed" with error
4. "maps workUnit fields to orchestrator propose params" — verify actionType ← intent, principalId ← actor.id, organizationId ← organizationId, parameters ← parameters
5. "derives cartridgeId from executor binding in registration" — verify the \_cartridgeId parameter is set

For the mock orchestrator, create a minimal object:

```typescript
const mockOrchestrator = {
  propose: vi.fn().mockResolvedValue({
    envelope: { id: "env-1", status: "executed" },
    decisionTrace: {
      /* minimal valid DecisionTrace */
    },
    approvalRequest: null,
    denied: false,
    explanation: "Allowed",
  }),
};
```

Read the actual `ProposeResult` type from `lifecycle.ts` to build correct mocks.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/modes/cartridge-mode.ts
import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";

interface CartridgeOrchestrator {
  propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
    cartridgeId: string;
    message?: string;
    traceId?: string;
    idempotencyKey?: string;
  }): Promise<{
    envelope: { id: string; status: string };
    approvalRequest: unknown | null;
    denied: boolean;
    explanation: string;
    governanceNote?: string;
  }>;
}

export interface CartridgeModeConfig {
  orchestrator: CartridgeOrchestrator;
  intentRegistry: { lookup: (intent: string) => IntentRegistration | undefined };
}

export class CartridgeMode implements ExecutionMode {
  name = "cartridge" as const;

  constructor(private config: CartridgeModeConfig) {}

  async execute(
    workUnit: WorkUnit,
    _constraints: ExecutionConstraints,
    _context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Resolve cartridgeId from intent registration
    const registration = this.config.intentRegistry.lookup(workUnit.intent);
    const cartridgeId = this.deriveCartridgeId(workUnit, registration);

    try {
      const result = await this.config.orchestrator.propose({
        actionType: workUnit.intent,
        parameters: { ...workUnit.parameters, _cartridgeId: cartridgeId },
        principalId: workUnit.actor.id,
        organizationId: workUnit.organizationId,
        cartridgeId,
        traceId: workUnit.traceId,
        idempotencyKey: workUnit.idempotencyKey,
      });

      if (result.denied) {
        return {
          workUnitId: workUnit.id,
          outcome: "failed",
          summary: result.explanation,
          outputs: {},
          mode: "cartridge",
          durationMs: Date.now() - startTime,
          traceId: workUnit.traceId,
          error: { code: "GOVERNANCE_DENIED", message: result.explanation },
        };
      }

      if (result.approvalRequest) {
        return {
          workUnitId: workUnit.id,
          outcome: "pending_approval",
          summary: result.explanation,
          outputs: { envelopeId: result.envelope.id },
          mode: "cartridge",
          durationMs: Date.now() - startTime,
          traceId: workUnit.traceId,
          approvalId: result.envelope.id,
        };
      }

      return {
        workUnitId: workUnit.id,
        outcome: "completed",
        summary: result.explanation,
        outputs: { envelopeId: result.envelope.id },
        mode: "cartridge",
        durationMs: Date.now() - startTime,
        traceId: workUnit.traceId,
      };
    } catch (err) {
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: err instanceof Error ? err.message : "Cartridge execution failed",
        outputs: {},
        mode: "cartridge",
        durationMs: Date.now() - startTime,
        traceId: workUnit.traceId,
        error: {
          code: "CARTRIDGE_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private deriveCartridgeId(workUnit: WorkUnit, registration?: IntentRegistration): string {
    // From registration executor binding
    if (registration?.executor.mode === "cartridge") {
      return registration.executor.actionId.split(".")[0] ?? workUnit.intent;
    }
    // Fallback: derive from intent (e.g., "campaign.pause" → first segment)
    return workUnit.intent.split(".")[0] ?? workUnit.intent;
  }
}
```

Note: The `CartridgeOrchestrator` interface is intentionally narrow — it only exposes what CartridgeMode needs from the orchestrator. This keeps the coupling minimal and testable. The actual `LifecycleOrchestrator` satisfies this interface because it has a `propose()` method with matching params.

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- cartridge-mode`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add CartridgeMode — ExecutionMode wrapping LifecycleOrchestrator"
```

---

## Task 2: Build cartridge intent auto-registrar

**Files:**

- Create: `packages/core/src/platform/cartridge-intent-registrar.ts`
- Create: `packages/core/src/platform/__tests__/cartridge-intent-registrar.test.ts`

- [ ] **Step 1: Read cartridge manifest types**

Read `packages/schemas/src/cartridge.ts` or `packages/cartridge-sdk/src/types.ts` to understand the manifest structure. Each cartridge manifest has `actions` with `name`, `riskCategory`, `description`, etc.

- [ ] **Step 2: Write the test**

Test cases:

1. "registers intents from cartridge manifest actions" — manifest with 2 actions → 2 intents registered
2. "uses cartridgeId.actionName as intent" — e.g., "digital-ads.campaign.pause"
3. "sets executor binding to cartridge mode with actionId" — executor: { mode: "cartridge", actionId: "digital-ads.campaign.pause" }
4. "derives mutationClass from risk category" — low/none → read, medium → write, high/critical → destructive
5. "skips actions without names"

The registrar should work with a simplified manifest shape:

```typescript
interface CartridgeManifestForRegistration {
  id: string;
  actions: Array<{
    name: string;
    description?: string;
    riskCategory?: string;
  }>;
}
```

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/cartridge-intent-registrar.ts
import type { IntentRegistry } from "./intent-registry.js";
import type { IntentRegistration } from "./intent-registration.js";
import type { MutationClass } from "./types.js";

export interface CartridgeManifestForRegistration {
  id: string;
  actions: Array<{
    name: string;
    description?: string;
    riskCategory?: string;
  }>;
}

function riskToMutationClass(risk?: string): MutationClass {
  if (!risk || risk === "none" || risk === "low") return "read";
  if (risk === "medium") return "write";
  return "destructive";
}

export function registerCartridgeIntents(
  registry: IntentRegistry,
  manifests: CartridgeManifestForRegistration[],
): void {
  for (const manifest of manifests) {
    for (const action of manifest.actions) {
      if (!action.name) continue;

      const intent = `${manifest.id}.${action.name}`;
      const mutationClass = riskToMutationClass(action.riskCategory);

      const registration: IntentRegistration = {
        intent,
        defaultMode: "cartridge",
        allowedModes: ["cartridge"],
        executor: { mode: "cartridge", actionId: intent },
        parameterSchema: { type: "object" },
        mutationClass,
        budgetClass: "cheap",
        approvalPolicy: mutationClass === "read" ? "none" : "threshold",
        idempotent: false,
        allowedTriggers: ["chat", "api", "schedule", "internal"],
        timeoutMs: 10_000,
        retryable: mutationClass === "read",
      };

      registry.register(registration);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- cartridge-intent-registrar`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add cartridge intent auto-registrar from manifests"
```

---

## Task 3: Barrel exports and verification

**Files:**

- Modify: `packages/core/src/platform/modes/index.ts`
- Modify: `packages/core/src/platform/index.ts`

- [ ] **Step 1: Add CartridgeMode to modes barrel**

Add to `packages/core/src/platform/modes/index.ts`:

```typescript
export { CartridgeMode } from "./cartridge-mode.js";
export type { CartridgeModeConfig } from "./cartridge-mode.js";
```

- [ ] **Step 2: Add cartridge registrar to platform barrel**

Add to `packages/core/src/platform/index.ts`:

```typescript
// Cartridge mode
export { CartridgeMode } from "./modes/index.js";
export type { CartridgeModeConfig } from "./modes/index.js";

// Cartridge registrar
export { registerCartridgeIntents } from "./cartridge-intent-registrar.js";
export type { CartridgeManifestForRegistration } from "./cartridge-intent-registrar.js";
```

- [ ] **Step 3: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add CartridgeMode and cartridge registrar to platform exports"
```
