# Platform Convergence Phase 2 — Governance Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GovernanceGate that takes a WorkUnit and returns a GovernanceDecision, using existing policy engine, risk scorer, and identity resolution as internal primitives.

**Architecture:** The governance gate is a facade in `packages/core/src/platform/governance/` that wraps existing `engine/` functions without moving them. The orchestrator continues importing from `engine/` directly — zero import path changes to existing code. The gate translates between platform types (WorkUnit, GovernanceDecision) and engine types (ActionProposal, DecisionTrace). This is a bridge, not a rewrite.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-platform-convergence-design.md` (Phase 2, Section 3)

---

## Critical Type Notes (from review)

**Implementers MUST read these before coding. The inline code examples below have known type mismatches with the actual codebase.**

### 1. DecisionTrace actual fields (from `packages/schemas/src/decision-trace.ts`)

- `actionId` (NOT `proposalId`)
- `checks[].checkCode` (NOT `name`) — values: `FORBIDDEN_BEHAVIOR`, `TRUST_BEHAVIOR`, `RATE_LIMIT`, etc.
- `checks[].checkData` (NOT `input`) — `Record<string, unknown>`
- `checks[].humanDetail` (NOT `result`) — string
- `checks[].matched` (NOT `triggered`) — boolean
- `checks[].effect` — `"allow" | "deny" | "modify" | "skip" | "escalate"`
- Required fields: `explanation: string`, `evaluatedAt: Date`

### 2. ActionProposal (from `packages/schemas/src/chat.ts`)

This is a chat-domain type. The `evaluate()` function accepts it but only accesses `proposal.actionType`, `proposal.parameters`, and `proposal.id`. The adapter should populate the required chat fields with defaults:

```typescript
{ id: workUnit.id, actionType: workUnit.intent, parameters: workUnit.parameters,
  evidence: "platform-governance", confidence: 1, originatingMessageId: workUnit.id }
```

### 3. EvaluationContext (from `packages/core/src/engine/rule-evaluator.ts`)

All these fields are required:

```typescript
{ actionType: string, parameters: Record<string, unknown>, cartridgeId: string,
  principalId: string, organizationId: string | null, riskCategory: string,
  metadata: Record<string, unknown> }
```

The adapter must populate all of them. Map from WorkUnit: `actionType` ← `intent`, `principalId` ← `actor.id`, `organizationId` ← `organizationId`, `cartridgeId` ← derive from executor binding or use intent as fallback, `riskCategory` ← derive from `mutationClass`.

### 4. Spec deviation: No separate RiskScoringFacade or ApprovalRoutingFacade

The spec says Phase 2 creates these facade classes. This plan calls `evaluate()` directly instead, which internally handles risk scoring and approval routing. This is simpler and sufficient. The facades are not needed as standalone components since the GovernanceGate is the facade. Noted as intentional deviation.

---

## Key Design Decision: Facade, Not Extraction

The `engine/` module has 46 imports across 21 files. Moving those files would be a massive, risky refactor with zero functional value. Instead:

- `platform/governance/` **wraps** existing `engine/` functions
- Existing orchestrator code **keeps its imports unchanged**
- The governance gate **translates** between platform types and engine types
- Future phases can gradually migrate orchestrator → platform/governance imports

---

## File Map

| File                                                               | Action | Responsibility                                                                        |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------- |
| `packages/core/src/platform/governance/governance-gate.ts`         | Create | Main entry point: evaluateWorkUnit(workUnit, registration, deps) → GovernanceDecision |
| `packages/core/src/platform/governance/work-unit-adapter.ts`       | Create | Translate WorkUnit + IntentRegistration → ActionProposal + EvaluationContext          |
| `packages/core/src/platform/governance/decision-adapter.ts`        | Create | Translate DecisionTrace → GovernanceDecision                                          |
| `packages/core/src/platform/governance/constraint-resolver.ts`     | Create | Resolve ExecutionConstraints from IntentRegistration + deployment config              |
| `packages/core/src/platform/governance/index.ts`                   | Create | Barrel exports                                                                        |
| `packages/core/src/platform/index.ts`                              | Modify | Add governance exports                                                                |
| `packages/core/src/platform/__tests__/governance-gate.test.ts`     | Create | Integration tests for the full gate                                                   |
| `packages/core/src/platform/__tests__/work-unit-adapter.test.ts`   | Create | Unit tests for translation                                                            |
| `packages/core/src/platform/__tests__/decision-adapter.test.ts`    | Create | Unit tests for decision mapping                                                       |
| `packages/core/src/platform/__tests__/constraint-resolver.test.ts` | Create | Unit tests for constraint resolution                                                  |

---

## Task 1: WorkUnit → ActionProposal adapter

**Files:**

- Create: `packages/core/src/platform/governance/work-unit-adapter.ts`
- Create: `packages/core/src/platform/__tests__/work-unit-adapter.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { toActionProposal, toEvaluationContext } from "../governance/work-unit-adapter.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";

const workUnit: WorkUnit = {
  id: "wu-1",
  requestedAt: new Date().toISOString(),
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "campaign.pause",
  parameters: { campaignId: "camp-123" },
  resolvedMode: "cartridge",
  traceId: "trace-1",
  trigger: "chat",
  priority: "normal",
};

const registration: IntentRegistration = {
  intent: "campaign.pause",
  defaultMode: "cartridge",
  allowedModes: ["cartridge"],
  executor: { mode: "cartridge", actionId: "digital-ads.campaign.pause" },
  parameterSchema: {},
  mutationClass: "write",
  budgetClass: "cheap",
  approvalPolicy: "threshold",
  idempotent: true,
  allowedTriggers: ["chat", "api"],
  timeoutMs: 10_000,
  retryable: true,
};

describe("toActionProposal", () => {
  it("maps intent to actionType", () => {
    const proposal = toActionProposal(workUnit, registration);
    expect(proposal.actionType).toBe("campaign.pause");
  });

  it("maps workUnit id to proposal id", () => {
    const proposal = toActionProposal(workUnit, registration);
    expect(proposal.id).toBe("wu-1");
  });

  it("passes parameters through", () => {
    const proposal = toActionProposal(workUnit, registration);
    expect(proposal.parameters).toEqual({ campaignId: "camp-123" });
  });

  it("derives magnitude from parameters when present", () => {
    const wu = { ...workUnit, parameters: { amount: 500 } };
    const proposal = toActionProposal(wu, registration);
    expect(proposal.magnitude).toBe(500);
  });

  it("defaults magnitude to 0 when not derivable", () => {
    const proposal = toActionProposal(workUnit, registration);
    expect(proposal.magnitude).toBe(0);
  });
});

describe("toEvaluationContext", () => {
  it("builds evaluation context with workUnit metadata", () => {
    const ctx = toEvaluationContext(workUnit, registration);
    expect(ctx.parameters).toEqual({ campaignId: "camp-123" });
    expect(ctx.metadata["workUnitId"]).toBe("wu-1");
    expect(ctx.metadata["trigger"]).toBe("chat");
    expect(ctx.metadata["mutationClass"]).toBe("write");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- work-unit-adapter`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/governance/work-unit-adapter.ts
import type { ActionProposal } from "@switchboard/schemas";
import type { EvaluationContext } from "../../engine/rule-evaluator.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";

export function toActionProposal(
  workUnit: WorkUnit,
  _registration: IntentRegistration,
): ActionProposal {
  const magnitude = deriveMagnitude(workUnit.parameters);

  return {
    id: workUnit.id,
    actionType: workUnit.intent,
    parameters: workUnit.parameters,
    magnitude,
    status: "proposed",
  };
}

export function toEvaluationContext(
  workUnit: WorkUnit,
  registration: IntentRegistration,
): EvaluationContext {
  return {
    parameters: workUnit.parameters,
    metadata: {
      workUnitId: workUnit.id,
      trigger: workUnit.trigger,
      mutationClass: registration.mutationClass,
      budgetClass: registration.budgetClass,
      approvalPolicy: registration.approvalPolicy,
      envelopeId: workUnit.id,
    },
  };
}

function deriveMagnitude(parameters: Record<string, unknown>): number {
  if (typeof parameters.amount === "number") return parameters.amount;
  if (typeof parameters.budget === "number") return parameters.budget;
  if (typeof parameters.spend === "number") return parameters.spend;
  return 0;
}
```

Note: You need to check the actual `ActionProposal` type from `@switchboard/schemas`. Read `packages/schemas/src/action.ts` to see its shape. The `status` field may use a specific literal type. Adjust accordingly.

Also check `EvaluationContext` from `packages/core/src/engine/rule-evaluator.ts` — it has `parameters` and `metadata` fields. Read the file to confirm the exact shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- work-unit-adapter`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add WorkUnit to ActionProposal adapter for governance gate"
```

---

## Task 2: DecisionTrace → GovernanceDecision adapter

**Files:**

- Create: `packages/core/src/platform/governance/decision-adapter.ts`
- Create: `packages/core/src/platform/__tests__/decision-adapter.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { toGovernanceDecision } from "../governance/decision-adapter.js";
import type { ExecutionConstraints } from "../governance-types.js";

const defaultConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default", "premium", "critical"],
  maxToolCalls: 5,
  maxLlmTurns: 6,
  maxTotalTokens: 64_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

describe("toGovernanceDecision", () => {
  it("maps allow + no approval to execute", () => {
    const decision = toGovernanceDecision(
      {
        finalDecision: "allow",
        approvalRequired: "none",
        computedRiskScore: { rawScore: 15, category: "low", factors: [] },
        checks: [],
        envelopeId: "e1",
        proposalId: "p1",
      },
      defaultConstraints,
    );
    expect(decision.outcome).toBe("execute");
    if (decision.outcome === "execute") {
      expect(decision.riskScore).toBe(15);
      expect(decision.constraints).toEqual(defaultConstraints);
    }
  });

  it("maps allow + approval to require_approval", () => {
    const decision = toGovernanceDecision(
      {
        finalDecision: "allow",
        approvalRequired: "standard",
        computedRiskScore: { rawScore: 45, category: "medium", factors: [] },
        checks: [],
        envelopeId: "e1",
        proposalId: "p1",
      },
      defaultConstraints,
    );
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("standard");
    }
  });

  it("maps deny to deny", () => {
    const decision = toGovernanceDecision(
      {
        finalDecision: "deny",
        approvalRequired: "none",
        computedRiskScore: { rawScore: 85, category: "critical", factors: [] },
        checks: [
          {
            name: "FORBIDDEN_BEHAVIOR",
            input: {},
            result: "Forbidden",
            triggered: true,
            effect: "deny",
          },
        ],
        envelopeId: "e1",
        proposalId: "p1",
      },
      defaultConstraints,
    );
    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "deny") {
      expect(decision.reasonCode).toBe("FORBIDDEN_BEHAVIOR");
    }
  });

  it("extracts matched policy names from checks", () => {
    const decision = toGovernanceDecision(
      {
        finalDecision: "allow",
        approvalRequired: "none",
        computedRiskScore: { rawScore: 10, category: "none", factors: [] },
        checks: [
          { name: "RATE_LIMIT", input: {}, result: "OK", triggered: false, effect: "skip" },
          {
            name: "POLICY_RULE",
            input: { policyId: "pol-1" },
            result: "Allowed",
            triggered: true,
            effect: "allow",
          },
        ],
        envelopeId: "e1",
        proposalId: "p1",
      },
      defaultConstraints,
    );
    if (decision.outcome === "execute") {
      expect(decision.matchedPolicies).toContain("POLICY_RULE");
    }
  });
});
```

Note: Check the actual `DecisionTrace` type from `@switchboard/schemas` — read `packages/schemas/src/policy.ts` or wherever it's defined. The fields are: `finalDecision`, `approvalRequired`, `computedRiskScore`, `checks`, `envelopeId`, `proposalId`. Each check has `name`, `input`, `result`, `triggered`, `effect`. Adjust test if needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- decision-adapter`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/governance/decision-adapter.ts
import type { DecisionTrace } from "@switchboard/schemas";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";

export function toGovernanceDecision(
  trace: DecisionTrace,
  constraints: ExecutionConstraints,
): GovernanceDecision {
  const riskScore = trace.computedRiskScore?.rawScore ?? 0;
  const matchedPolicies = trace.checks.filter((c) => c.triggered).map((c) => c.name);

  if (trace.finalDecision === "deny") {
    const denyCheck = trace.checks.find((c) => c.effect === "deny" && c.triggered);
    return {
      outcome: "deny",
      reasonCode: denyCheck?.name ?? "POLICY_DENY",
      riskScore,
      matchedPolicies,
    };
  }

  if (trace.approvalRequired !== "none") {
    return {
      outcome: "require_approval",
      riskScore,
      approvalLevel: trace.approvalRequired,
      approvers: [],
      constraints,
      matchedPolicies,
    };
  }

  return {
    outcome: "execute",
    riskScore,
    budgetProfile: riskScore <= 20 ? "cheap" : riskScore <= 60 ? "standard" : "expensive",
    constraints,
    matchedPolicies,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- decision-adapter`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add DecisionTrace to GovernanceDecision adapter"
```

---

## Task 3: ExecutionConstraints resolver

**Files:**

- Create: `packages/core/src/platform/governance/constraint-resolver.ts`
- Create: `packages/core/src/platform/__tests__/constraint-resolver.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { resolveConstraints, DEFAULT_CONSTRAINTS } from "../governance/constraint-resolver.js";
import type { IntentRegistration } from "../intent-registration.js";

const baseRegistration: IntentRegistration = {
  intent: "campaign.pause",
  defaultMode: "cartridge",
  allowedModes: ["cartridge"],
  executor: { mode: "cartridge", actionId: "digital-ads.campaign.pause" },
  parameterSchema: {},
  mutationClass: "write",
  budgetClass: "cheap",
  approvalPolicy: "threshold",
  idempotent: true,
  allowedTriggers: ["chat", "api"],
  timeoutMs: 10_000,
  retryable: true,
};

describe("resolveConstraints", () => {
  it("derives constraints from registration budgetClass and timeoutMs", () => {
    const constraints = resolveConstraints(baseRegistration);
    // baseRegistration has budgetClass: "cheap" and timeoutMs: 10_000
    expect(constraints.maxTotalTokens).toBe(32_000); // cheap budget
    expect(constraints.maxRuntimeMs).toBe(10_000); // from registration
    expect(constraints.maxLlmTurns).toBe(3); // cheap budget
  });

  it("uses registration timeoutMs as maxRuntimeMs", () => {
    const reg = { ...baseRegistration, timeoutMs: 5_000 };
    const constraints = resolveConstraints(reg);
    expect(constraints.maxRuntimeMs).toBe(5_000);
  });

  it("maps cheap budgetClass to lower token limits", () => {
    const reg = { ...baseRegistration, budgetClass: "cheap" as const };
    const constraints = resolveConstraints(reg);
    expect(constraints.maxTotalTokens).toBeLessThanOrEqual(32_000);
  });

  it("maps expensive budgetClass to higher token limits", () => {
    const reg = { ...baseRegistration, budgetClass: "expensive" as const };
    const constraints = resolveConstraints(reg);
    expect(constraints.maxTotalTokens).toBe(128_000);
  });

  it("maps standard budgetClass to default token limits", () => {
    const reg = { ...baseRegistration, budgetClass: "standard" as const };
    const constraints = resolveConstraints(reg);
    expect(constraints.maxTotalTokens).toBe(64_000);
  });

  it("sets trustLevel from deployment override when provided", () => {
    const constraints = resolveConstraints(baseRegistration, {
      trustLevel: "autonomous",
    });
    expect(constraints.trustLevel).toBe("autonomous");
  });

  it("defaults trustLevel to guided", () => {
    const constraints = resolveConstraints(baseRegistration);
    expect(constraints.trustLevel).toBe("guided");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- constraint-resolver`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/governance/constraint-resolver.ts
import type { ExecutionConstraints } from "../governance-types.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { BudgetClass } from "../types.js";

export interface ConstraintOverrides {
  trustLevel?: "supervised" | "guided" | "autonomous";
  allowedModelTiers?: Array<"default" | "premium" | "critical">;
  maxWritesPerExecution?: number;
}

export const DEFAULT_CONSTRAINTS: ExecutionConstraints = {
  allowedModelTiers: ["default", "premium", "critical"],
  maxToolCalls: 5,
  maxLlmTurns: 6,
  maxTotalTokens: 64_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

const BUDGET_TOKEN_LIMITS: Record<BudgetClass, number> = {
  cheap: 32_000,
  standard: 64_000,
  expensive: 128_000,
};

const BUDGET_TURN_LIMITS: Record<BudgetClass, number> = {
  cheap: 3,
  standard: 6,
  expensive: 10,
};

export function resolveConstraints(
  registration: IntentRegistration,
  overrides?: ConstraintOverrides,
): ExecutionConstraints {
  return {
    allowedModelTiers: overrides?.allowedModelTiers ?? DEFAULT_CONSTRAINTS.allowedModelTiers,
    maxToolCalls: DEFAULT_CONSTRAINTS.maxToolCalls,
    maxLlmTurns: BUDGET_TURN_LIMITS[registration.budgetClass],
    maxTotalTokens: BUDGET_TOKEN_LIMITS[registration.budgetClass],
    maxRuntimeMs: registration.timeoutMs,
    maxWritesPerExecution:
      overrides?.maxWritesPerExecution ?? DEFAULT_CONSTRAINTS.maxWritesPerExecution,
    trustLevel: overrides?.trustLevel ?? DEFAULT_CONSTRAINTS.trustLevel,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- constraint-resolver`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add ExecutionConstraints resolver from intent registration"
```

---

## Task 4: GovernanceGate — the main entry point

**Files:**

- Create: `packages/core/src/platform/governance/governance-gate.ts`
- Create: `packages/core/src/platform/__tests__/governance-gate.test.ts`

This is the most important file. It ties everything together.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { GovernanceGate } from "../governance/governance-gate.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";

const workUnit: WorkUnit = {
  id: "wu-1",
  requestedAt: new Date().toISOString(),
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "campaign.pause",
  parameters: { campaignId: "camp-123" },
  resolvedMode: "cartridge",
  traceId: "trace-1",
  trigger: "chat",
  priority: "normal",
};

const registration: IntentRegistration = {
  intent: "campaign.pause",
  defaultMode: "cartridge",
  allowedModes: ["cartridge"],
  executor: { mode: "cartridge", actionId: "digital-ads.campaign.pause" },
  parameterSchema: {},
  mutationClass: "write",
  budgetClass: "standard",
  approvalPolicy: "threshold",
  idempotent: true,
  allowedTriggers: ["chat", "api"],
  timeoutMs: 10_000,
  retryable: true,
};

describe("GovernanceGate", () => {
  it("returns execute decision when policy allows", () => {
    // Mock the policy evaluate function to return allow
    const mockEvaluate = vi.fn().mockReturnValue({
      finalDecision: "allow",
      approvalRequired: "none",
      computedRiskScore: { rawScore: 15, category: "low", factors: [] },
      checks: [],
      envelopeId: "wu-1",
      proposalId: "wu-1",
    });

    const mockResolveIdentity = vi.fn().mockReturnValue({
      spec: {},
      activeOverlays: [],
      effectiveRiskTolerance: {
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      },
      effectiveSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
      effectiveForbiddenBehaviors: [],
      effectiveTrustBehaviors: [],
      delegatedApprovers: [],
    });

    const gate = new GovernanceGate({
      evaluate: mockEvaluate,
      resolveIdentity: mockResolveIdentity,
      loadPolicies: vi.fn().mockResolvedValue([]),
      loadIdentitySpec: vi.fn().mockResolvedValue({ spec: {}, overlays: [] }),
    });

    const result = gate.evaluateSync(workUnit, registration);
    expect(result.outcome).toBe("execute");
    if (result.outcome === "execute") {
      expect(result.riskScore).toBe(15);
      expect(result.constraints.maxRuntimeMs).toBe(10_000);
    }
  });

  it("returns deny decision when policy denies", () => {
    const mockEvaluate = vi.fn().mockReturnValue({
      finalDecision: "deny",
      approvalRequired: "none",
      computedRiskScore: { rawScore: 85, category: "critical", factors: [] },
      checks: [
        {
          name: "FORBIDDEN_BEHAVIOR",
          input: {},
          result: "Forbidden",
          triggered: true,
          effect: "deny",
        },
      ],
      envelopeId: "wu-1",
      proposalId: "wu-1",
    });

    const gate = new GovernanceGate({
      evaluate: mockEvaluate,
      resolveIdentity: vi.fn().mockReturnValue({
        spec: {},
        activeOverlays: [],
        effectiveRiskTolerance: {},
        effectiveSpendLimits: {},
        effectiveForbiddenBehaviors: ["campaign.pause"],
        effectiveTrustBehaviors: [],
        delegatedApprovers: [],
      }),
      loadPolicies: vi.fn().mockResolvedValue([]),
      loadIdentitySpec: vi.fn().mockResolvedValue({ spec: {}, overlays: [] }),
    });

    const result = gate.evaluateSync(workUnit, registration);
    expect(result.outcome).toBe("deny");
  });

  it("returns require_approval when policy requires approval", () => {
    const mockEvaluate = vi.fn().mockReturnValue({
      finalDecision: "allow",
      approvalRequired: "elevated",
      computedRiskScore: { rawScore: 65, category: "high", factors: [] },
      checks: [],
      envelopeId: "wu-1",
      proposalId: "wu-1",
    });

    const gate = new GovernanceGate({
      evaluate: mockEvaluate,
      resolveIdentity: vi.fn().mockReturnValue({
        spec: {},
        activeOverlays: [],
        effectiveRiskTolerance: {},
        effectiveSpendLimits: {},
        effectiveForbiddenBehaviors: [],
        effectiveTrustBehaviors: [],
        delegatedApprovers: [],
      }),
      loadPolicies: vi.fn().mockResolvedValue([]),
      loadIdentitySpec: vi.fn().mockResolvedValue({ spec: {}, overlays: [] }),
    });

    const result = gate.evaluateSync(workUnit, registration);
    expect(result.outcome).toBe("require_approval");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- governance-gate`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/governance/governance-gate.ts
import type { ActionProposal, DecisionTrace, Policy } from "@switchboard/schemas";
import type { EvaluationContext } from "../../engine/rule-evaluator.js";
import type { PolicyEngineContext } from "../../engine/policy-engine.js";
import type { ResolvedIdentity } from "../../identity/spec.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { GovernanceDecision } from "../governance-types.js";
import { toActionProposal, toEvaluationContext } from "./work-unit-adapter.js";
import { toGovernanceDecision } from "./decision-adapter.js";
import { resolveConstraints } from "./constraint-resolver.js";
import type { ConstraintOverrides } from "./constraint-resolver.js";

export interface GovernanceGateDeps {
  evaluate: (
    proposal: ActionProposal,
    evalContext: EvaluationContext,
    engineContext: PolicyEngineContext,
  ) => DecisionTrace;
  resolveIdentity: (...args: unknown[]) => ResolvedIdentity;
  loadPolicies: (orgId: string) => Promise<Policy[]>;
  loadIdentitySpec: (actorId: string) => Promise<{ spec: unknown; overlays: unknown[] }>;
}

export class GovernanceGate {
  constructor(private deps: GovernanceGateDeps) {}

  evaluateSync(
    workUnit: WorkUnit,
    registration: IntentRegistration,
    overrides?: ConstraintOverrides,
  ): GovernanceDecision {
    const proposal = toActionProposal(workUnit, registration);
    const evalContext = toEvaluationContext(workUnit, registration);
    const constraints = resolveConstraints(registration, overrides);

    // Build the policy engine context from dependencies
    const resolvedIdentity = this.deps.resolveIdentity();
    const engineContext: PolicyEngineContext = {
      policies: [],
      guardrails: null,
      guardrailState: { actionCounts: new Map(), lastActionTimes: new Map() },
      resolvedIdentity,
      riskInput: null,
    };

    const trace = this.deps.evaluate(proposal, evalContext, engineContext);
    return toGovernanceDecision(trace, constraints);
  }

  async evaluate(
    workUnit: WorkUnit,
    registration: IntentRegistration,
    overrides?: ConstraintOverrides,
  ): Promise<GovernanceDecision> {
    const [policies, identityData] = await Promise.all([
      this.deps.loadPolicies(workUnit.organizationId),
      this.deps.loadIdentitySpec(workUnit.actor.id),
    ]);

    const proposal = toActionProposal(workUnit, registration);
    const evalContext = toEvaluationContext(workUnit, registration);
    const constraints = resolveConstraints(registration, overrides);

    const resolvedIdentity = this.deps.resolveIdentity(
      identityData.spec,
      identityData.overlays,
      {},
    );

    const engineContext: PolicyEngineContext = {
      policies,
      guardrails: null,
      guardrailState: { actionCounts: new Map(), lastActionTimes: new Map() },
      resolvedIdentity,
      riskInput: null,
    };

    const trace = this.deps.evaluate(proposal, evalContext, engineContext);
    return toGovernanceDecision(trace, constraints);
  }
}
```

Note: The `GovernanceGateDeps` types may need adjustment based on the actual signatures of `evaluate` from `engine/policy-engine.ts` and `resolveIdentity` from `identity/spec.ts`. Read those files to confirm. The deps pattern keeps the gate testable without importing concrete implementations.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- governance-gate`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass — gate is additive, no existing code changed

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(core): add GovernanceGate — shared ingress-time policy evaluation"
```

---

## Task 5: Barrel exports and verification

**Files:**

- Create: `packages/core/src/platform/governance/index.ts`
- Modify: `packages/core/src/platform/index.ts`

- [ ] **Step 1: Write governance barrel**

```typescript
// packages/core/src/platform/governance/index.ts
export { GovernanceGate } from "./governance-gate.js";
export type { GovernanceGateDeps } from "./governance-gate.js";
export { toActionProposal, toEvaluationContext } from "./work-unit-adapter.js";
export { toGovernanceDecision } from "./decision-adapter.js";
export { resolveConstraints, DEFAULT_CONSTRAINTS } from "./constraint-resolver.js";
export type { ConstraintOverrides } from "./constraint-resolver.js";
```

- [ ] **Step 2: Add governance to platform barrel**

Add to the end of `packages/core/src/platform/index.ts`:

```typescript
// Governance
export { GovernanceGate } from "./governance/index.js";
export type { GovernanceGateDeps, ConstraintOverrides } from "./governance/index.js";
export { resolveConstraints, DEFAULT_CONSTRAINTS } from "./governance/index.js";
```

- [ ] **Step 3: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass

- [ ] **Step 4: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: No new errors in platform/

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add governance barrel exports to platform module"
```
