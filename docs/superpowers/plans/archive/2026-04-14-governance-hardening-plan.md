# Governance Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add confidence scoring, idempotency coverage, and notification tiers to the Switchboard governance pipeline.

**Architecture:** Three additive features wired into existing infrastructure — confidence scorer plugs into policy engine between risk scoring and approval determination, idempotency guard wraps action executor for write operations, notification classifier and batcher extend the existing notification module.

**Tech Stack:** TypeScript, Vitest, Zod, existing policy engine + IdempotencyGuard + ProactiveSender

**Spec:** `docs/superpowers/specs/2026-04-14-governance-hardening-design.md`

**Codebase:** `/Users/jasonljc/switchboard`

---

## File Structure

| File                                                                        | Action | Purpose                                                        |
| --------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `packages/schemas/src/decision-trace.ts`                                    | Modify | Add `CONFIDENCE` + `MANUAL_APPROVAL_GATE` to `CheckCodeSchema` |
| `packages/core/src/engine/confidence.ts`                                    | Create | Pure confidence scorer — signals × weights → level             |
| `packages/core/src/__tests__/confidence.test.ts`                            | Create | Tests for scorer                                               |
| `packages/core/src/engine/policy-engine.ts`                                 | Modify | Wire confidence (step 8.5) + manual approval gate (step 0)     |
| `packages/core/src/__tests__/engine-policy.test.ts`                         | Modify | Tests for new policy engine behavior                           |
| `packages/core/src/engine/index.ts`                                         | Modify | Re-export confidence types                                     |
| `docs/audits/2026-04-14-idempotency-coverage.md`                            | Create | Audit doc                                                      |
| `packages/agents/src/action-executor.ts`                                    | Modify | Add optional IdempotencyGuard for write dedup                  |
| `packages/agents/src/__tests__/action-executor.test.ts`                     | Modify | Tests for idempotency                                          |
| `packages/core/src/notifications/notification-classifier.ts`                | Create | Event → T1/T2/T3 classifier                                    |
| `packages/core/src/notifications/__tests__/notification-classifier.test.ts` | Create | Tests for classifier                                           |
| `packages/core/src/notifications/notification-batcher.ts`                   | Create | T2 batching with timer + count flush                           |
| `packages/core/src/notifications/__tests__/notification-batcher.test.ts`    | Create | Tests for batcher                                              |
| `packages/core/src/notifications/index.ts`                                  | Modify | Re-export classifier + batcher                                 |

---

## Task 1: Add CheckCode enum values

**Files:**

- Modify: `packages/schemas/src/decision-trace.ts:5-20`

- [ ] **Step 1: Add CONFIDENCE and MANUAL_APPROVAL_GATE to CheckCodeSchema**

In `packages/schemas/src/decision-trace.ts`, add two values to the `CheckCodeSchema` enum:

```typescript
export const CheckCodeSchema = z.enum([
  "FORBIDDEN_BEHAVIOR",
  "TRUST_BEHAVIOR",
  "RATE_LIMIT",
  "COOLDOWN",
  "PROTECTED_ENTITY",
  "SPEND_LIMIT",
  "POLICY_RULE",
  "RISK_SCORING",
  "RESOLVER_AMBIGUITY",
  "COMPETENCE_TRUST",
  "COMPETENCE_ESCALATION",
  "COMPOSITE_RISK",
  "DELEGATION_CHAIN",
  "SYSTEM_POSTURE",
  "CONFIDENCE",
  "MANUAL_APPROVAL_GATE",
]);
```

- [ ] **Step 2: Run schema tests**

```bash
pnpm --filter @switchboard/schemas test -- --run
```

Expected: PASS — enum values are additive.

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/decision-trace.ts
git commit -m "feat(schemas): add CONFIDENCE and MANUAL_APPROVAL_GATE check codes"
```

---

## Task 2: Confidence Scorer

**Files:**

- Create: `packages/core/src/__tests__/confidence.test.ts`
- Create: `packages/core/src/engine/confidence.ts`
- Modify: `packages/core/src/engine/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/__tests__/confidence.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeConfidence } from "../engine/confidence.js";

describe("computeConfidence", () => {
  it("returns high confidence for low-risk action with complete params", () => {
    const result = computeConfidence({
      riskScore: 10,
      schemaComplete: true,
      hasRequiredParams: true,
      retrievalQuality: 0.9,
      toolSuccessRate: 1.0,
    });
    expect(result.level).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(0.75);
  });

  it("returns low confidence for high-risk action with missing params", () => {
    const result = computeConfidence({
      riskScore: 75,
      schemaComplete: false,
      hasRequiredParams: false,
      retrievalQuality: 0.3,
      toolSuccessRate: 0.5,
    });
    expect(result.level).toBe("low");
    expect(result.score).toBeLessThan(0.45);
  });

  it("returns medium confidence for moderate signals", () => {
    const result = computeConfidence({
      riskScore: 45,
      schemaComplete: true,
      hasRequiredParams: true,
      retrievalQuality: 0.6,
      toolSuccessRate: 0.8,
    });
    expect(result.level).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(0.45);
    expect(result.score).toBeLessThan(0.75);
  });

  it("degrades confidence when schema incomplete even if risk is low", () => {
    const result = computeConfidence({
      riskScore: 10,
      schemaComplete: false,
      hasRequiredParams: false,
    });
    expect(result.level).not.toBe("high");
  });

  it("uses defaults for optional signals", () => {
    const result = computeConfidence({
      riskScore: 20,
      schemaComplete: true,
      hasRequiredParams: true,
    });
    // retrievalQuality defaults to 0.7, toolSuccessRate defaults to 0.8
    // risk: (1 - 20/100) * 0.3 = 0.24
    // schema: 1.0 * 0.3 = 0.30
    // retrieval: 0.7 * 0.2 = 0.14
    // tool: 0.8 * 0.2 = 0.16
    // total: 0.84 → high
    expect(result.level).toBe("high");
    expect(result.factors).toHaveLength(4);
  });

  it("includes all factors in result", () => {
    const result = computeConfidence({
      riskScore: 50,
      schemaComplete: true,
      hasRequiredParams: true,
      retrievalQuality: 0.5,
      toolSuccessRate: 0.9,
    });
    expect(result.factors).toEqual([
      { signal: "risk_score", value: 0.5, weight: 0.3 },
      { signal: "schema_complete", value: 1.0, weight: 0.3 },
      { signal: "retrieval_quality", value: 0.5, weight: 0.2 },
      { signal: "tool_success_rate", value: 0.9, weight: 0.2 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- --run confidence
```

Expected: FAIL — module `../engine/confidence.js` not found.

- [ ] **Step 3: Implement confidence scorer**

Create `packages/core/src/engine/confidence.ts`:

```typescript
// ---------------------------------------------------------------------------
// Confidence Scorer — per-action confidence evaluation
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ConfidenceInput {
  /** Risk score from the risk scorer (0-100) */
  riskScore: number;
  /** Are all action parameters present and valid against schema? */
  schemaComplete: boolean;
  /** Are the required params specifically provided (not defaults)? */
  hasRequiredParams: boolean;
  /** Quality of retrieved knowledge (0-1), if applicable */
  retrievalQuality?: number;
  /** Historical success rate of this tool (0-1), if tracked */
  toolSuccessRate?: number;
}

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  factors: Array<{ signal: string; value: number; weight: number }>;
}

const THRESHOLDS = { high: 0.75, medium: 0.45 } as const;

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const factors: ConfidenceResult["factors"] = [];

  const riskFactor = Math.max(0, 1 - input.riskScore / 100);
  factors.push({ signal: "risk_score", value: riskFactor, weight: 0.3 });

  const schemaFactor = input.schemaComplete && input.hasRequiredParams ? 1.0 : 0.2;
  factors.push({ signal: "schema_complete", value: schemaFactor, weight: 0.3 });

  const retrievalFactor = input.retrievalQuality ?? 0.7;
  factors.push({ signal: "retrieval_quality", value: retrievalFactor, weight: 0.2 });

  const toolFactor = input.toolSuccessRate ?? 0.8;
  factors.push({ signal: "tool_success_rate", value: toolFactor, weight: 0.2 });

  const score = factors.reduce((sum, f) => sum + f.value * f.weight, 0);

  const level: ConfidenceLevel =
    score >= THRESHOLDS.high ? "high" : score >= THRESHOLDS.medium ? "medium" : "low";

  return { score, level, factors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- --run confidence
```

Expected: PASS — all 6 tests.

- [ ] **Step 5: Export from engine barrel**

In `packages/core/src/engine/index.ts`, add:

```typescript
export { computeConfidence } from "./confidence.js";
export type { ConfidenceInput, ConfidenceResult, ConfidenceLevel } from "./confidence.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/engine/confidence.ts packages/core/src/__tests__/confidence.test.ts packages/core/src/engine/index.ts
git commit -m "feat(core): add confidence scorer for per-action evaluation"
```

---

## Task 3: Wire Confidence + Manual Gate into Policy Engine

**Files:**

- Modify: `packages/core/src/engine/policy-engine.ts`
- Modify: `packages/core/src/__tests__/engine-policy.test.ts`

**Reference:** The `evaluate()` function is in `packages/core/src/engine/policy-engine.ts:550-625`. The steps are:

- Step 1: Forbidden behaviors (line 564)
- Step 2: Trust behaviors (line 569)
- Steps 3-5: Guardrails (line 572)
- Step 6: Spend limits (line 577)
- Step 7: Policy rules (line 583)
- Step 8: Risk scoring (line 596)
- Step 9: Approval requirement (line 604)
- Step 10: Final decision (line 622)

The `determineApprovalRequirement()` function is at line 508-548.

The trace builder pattern uses `addCheck()` from `./decision-trace.js`.

- [ ] **Step 1: Write failing tests for manual approval gate**

Add to `packages/core/src/__tests__/engine-policy.test.ts`:

```typescript
describe("manual approval gate", () => {
  it("requires mandatory approval when requiresManualApproval metadata is set", () => {
    const evalCtx = makeEvalContext({
      metadata: { requiresManualApproval: true },
    });
    const engineCtx = makeEngineContext();
    const proposal = makeProposal();

    const trace = evaluate(proposal, evalCtx, engineCtx);

    expect(trace.approvalRequired).toBe("mandatory");
    expect(trace.finalDecision).toBe("allow");
    expect(trace.checks.some((c) => c.checkCode === "MANUAL_APPROVAL_GATE")).toBe(true);
  });

  it("skips manual gate when metadata not set", () => {
    const evalCtx = makeEvalContext({ metadata: {} });
    const engineCtx = makeEngineContext();
    const proposal = makeProposal();

    const trace = evaluate(proposal, evalCtx, engineCtx);

    expect(trace.checks.some((c) => c.checkCode === "MANUAL_APPROVAL_GATE")).toBe(false);
  });

  it("manual gate takes precedence over forbidden behavior", () => {
    const evalCtx = makeEvalContext({
      actionType: "account.delete",
      metadata: { requiresManualApproval: true },
    });
    const engineCtx = makeEngineContext();
    const proposal = makeProposal({ actionType: "account.delete" });

    const trace = evaluate(proposal, evalCtx, engineCtx);

    // Manual gate fires first (Step 0), forbidden check (Step 1) never runs
    expect(trace.approvalRequired).toBe("mandatory");
    expect(trace.finalDecision).toBe("allow");
    expect(trace.checks.some((c) => c.checkCode === "FORBIDDEN_BEHAVIOR")).toBe(false);
  });
});
```

Use the existing `makeEngineContext()` / `makeProposal()` helpers already in the test file. If they don't exist with those exact names, use whatever helper factory the test file provides (check the file — it has `makeEvalContext`; for `engineCtx` and `proposal`, follow the existing pattern).

- [ ] **Step 2: Write failing tests for confidence escalation**

Add to `packages/core/src/__tests__/engine-policy.test.ts`:

```typescript
describe("confidence escalation", () => {
  it("escalates to standard approval when confidence is low and current decision is none", () => {
    // Use a low-risk action that would normally get "none" approval
    const evalCtx = makeEvalContext({
      actionType: "campaign.read",
      parameters: {},
    });
    // Set up context so the action gets "none" approval normally
    // but with bad schema/retrieval to tank confidence
    const engineCtx = makeEngineContext({
      riskInput: {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      },
    });
    const proposal = makeProposal({ actionType: "campaign.read" });

    const trace = evaluate(proposal, evalCtx, engineCtx);

    // Confidence check should be in trace
    expect(trace.checks.some((c) => c.checkCode === "CONFIDENCE")).toBe(true);
  });
});
```

Note: The exact assertion depends on whether the test helpers produce a scenario where confidence is low enough to trigger escalation. You may need to adjust after seeing which approval the engine currently assigns. The key is that a `CONFIDENCE` check appears in the trace.

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- --run engine-policy
```

Expected: FAIL — `MANUAL_APPROVAL_GATE` and `CONFIDENCE` check codes not found in traces (functions not yet modified).

- [ ] **Step 4: Add manual approval gate (Step 0) to evaluate()**

In `packages/core/src/engine/policy-engine.ts`, add import at the top:

```typescript
import { computeConfidence } from "./confidence.js";
import type { ConfidenceResult } from "./confidence.js";
```

Then in `evaluate()`, before the existing `// Step 1: Forbidden behaviors` line, add:

```typescript
// Step 0: Manual approval gate — hard requirement regardless of trust
if (evalContext.metadata["requiresManualApproval"]) {
  const riskScoreResult = riskInput(engineContext, config);
  builder.computedRiskScore = riskScoreResult;
  addCheck(
    builder,
    "MANUAL_APPROVAL_GATE",
    { tool: proposal.actionType },
    `Tool "${proposal.actionType}" requires manual approval regardless of trust level.`,
    true,
    "skip",
  );
  builder.finalDecision = "allow";
  builder.approvalRequired = "mandatory";
  return buildTrace(builder);
}
```

- [ ] **Step 5: Add confidence scoring (Step 8.5) to evaluate()**

After `// Step 8: Compute risk score` (the `computeFinalRisk` call), before `// Step 9: Determine approval requirement`, add:

```typescript
// Step 8.5: Compute confidence
// schemaComplete/hasRequiredParams can be provided explicitly via metadata
// (set upstream by the orchestrator after schema validation).
// Falls back to presence heuristic — acceptable for v1, but callers should
// set metadata["schemaComplete"] and metadata["hasRequiredParams"] for accuracy.
const schemaComplete =
  typeof evalContext.metadata["schemaComplete"] === "boolean"
    ? evalContext.metadata["schemaComplete"]
    : Boolean(evalContext.parameters && Object.keys(evalContext.parameters).length > 0);
const hasRequiredParams =
  typeof evalContext.metadata["hasRequiredParams"] === "boolean"
    ? evalContext.metadata["hasRequiredParams"]
    : schemaComplete;

const confidence = computeConfidence({
  riskScore: builder.computedRiskScore?.rawScore ?? 0,
  schemaComplete,
  hasRequiredParams,
  retrievalQuality: evalContext.metadata["retrievalQuality"] as number | undefined,
  toolSuccessRate: evalContext.metadata["toolSuccessRate"] as number | undefined,
});

addCheck(
  builder,
  "CONFIDENCE",
  {
    score: confidence.score,
    level: confidence.level,
    factors: confidence.factors,
  },
  `Confidence: ${confidence.score.toFixed(2)} (${confidence.level}).`,
  confidence.level === "low",
  "skip",
);
```

- [ ] **Step 6: Add confidence-based escalation in determineApprovalRequirement()**

Modify the `determineApprovalRequirement()` function signature to accept an optional confidence parameter:

```typescript
function determineApprovalRequirement(
  policyApprovalOverride: ApprovalRequirement | null,
  resolvedIdentity: ResolvedIdentity,
  finalRiskCategory: RiskCategory,
  systemRiskPosture: SystemRiskPosture | undefined,
  builder: ReturnType<typeof createTraceBuilder>,
  confidence?: ConfidenceResult,
): ApprovalRequirement {
```

At the end of the function, before `return approvalReq;`, add:

```typescript
// Confidence-based escalation — additive only, never downgrades
if (confidence?.level === "low" && approvalReq === "none") {
  approvalReq = "standard";
  addCheck(
    builder,
    "CONFIDENCE",
    { previousApproval: "none", newApproval: "standard", confidenceLevel: "low" },
    "Low confidence: escalating from auto-allow to standard approval.",
    true,
    "skip",
  );
}

return approvalReq;
```

Update the call site in `evaluate()` to pass confidence:

```typescript
const approvalReq = determineApprovalRequirement(
  policyResult.policyApprovalOverride,
  resolvedIdentity,
  finalRiskCategory,
  engineContext.systemRiskPosture,
  builder,
  confidence,
);
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @switchboard/core test -- --run engine-policy
```

Expected: PASS — all existing tests still pass, new tests pass.

- [ ] **Step 8: Run full core test suite**

```bash
pnpm --filter @switchboard/core test -- --run
```

Expected: PASS — confidence is additive, existing behavior unchanged.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/engine/policy-engine.ts packages/core/src/__tests__/engine-policy.test.ts
git commit -m "feat(core): wire confidence thresholds + manual approval gate into policy engine"
```

---

## Task 4: Idempotency Audit Document

**Files:**

- Create: `docs/audits/2026-04-14-idempotency-coverage.md`

- [ ] **Step 1: Audit idempotency coverage**

Search for all uses of `IdempotencyGuard` and `idempotency`:

```bash
pnpm exec grep -rn "idempotency\|IdempotencyGuard" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v test | grep -v ".d.ts"
```

Search for all action handlers registered in the system:

```bash
pnpm exec grep -rn "register(" packages/agents/ --include="*.ts" | grep -v node_modules | grep -v test
```

- [ ] **Step 2: Write audit document**

Create `docs/audits/2026-04-14-idempotency-coverage.md` documenting:

1. All execution paths (orchestrator `propose()`, `ActionExecutor.execute()`, HTTP middleware)
2. Which paths have idempotency coverage
3. Gaps identified
4. Recommended fixes

The key finding: `IdempotencyGuard` covers the orchestrator `propose()` pipeline. HTTP middleware covers API routes. But `ActionExecutor.execute()` in `packages/agents/` has NO dedup — a retry at the agent event loop level can produce duplicate side effects.

- [ ] **Step 3: Commit**

```bash
mkdir -p docs/audits
git add docs/audits/2026-04-14-idempotency-coverage.md
git commit -m "docs: idempotency coverage audit — gap in ActionExecutor execution path"
```

---

## Task 5: Fix Idempotency Gap in ActionExecutor

**Files:**

- Modify: `packages/agents/src/action-executor.ts`
- Modify: `packages/agents/src/__tests__/action-executor.test.ts`

**Reference:** `ActionExecutor` is at `packages/agents/src/action-executor.ts`. The existing constructor takes no args. `IdempotencyGuard` is at `packages/core/src/idempotency/guard.ts` with `checkDuplicate(principalId, actionType, params)` and `recordResponse(principalId, actionType, params, response)`.

- [ ] **Step 1: Write failing tests**

Add to `packages/agents/src/__tests__/action-executor.test.ts`:

```typescript
import { IdempotencyGuard, InMemoryIdempotencyStore } from "@switchboard/core";

describe("idempotency", () => {
  it("returns cached result for duplicate write action", async () => {
    const store = new InMemoryIdempotencyStore();
    const guard = new IdempotencyGuard({ store });
    const writeActions = new Set(["payments.charge.create"]);
    const executor = new ActionExecutor({ idempotencyGuard: guard, writeActions });

    const handler = vi.fn().mockResolvedValue({ success: true, result: { chargeId: "ch-1" } });
    executor.register("payments.charge.create", handler);

    const bridge = new PolicyBridge(null);
    const action = { actionType: "payments.charge.create", parameters: { amount: 100 } };
    const ctx = { organizationId: "org-1" };

    const result1 = await executor.execute(action, ctx, bridge);
    const result2 = await executor.execute(action, ctx, bridge);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result2.result).toEqual(result1.result);
    expect(handler).toHaveBeenCalledTimes(1); // Only executed once
  });

  it("does not apply idempotency to read actions", async () => {
    const store = new InMemoryIdempotencyStore();
    const guard = new IdempotencyGuard({ store });
    const writeActions = new Set(["payments.charge.create"]);
    const executor = new ActionExecutor({ idempotencyGuard: guard, writeActions });

    const handler = vi.fn().mockResolvedValue({ success: true, result: { contacts: [] } });
    executor.register("crm.contact.search", handler);

    const bridge = new PolicyBridge(null);
    const action = { actionType: "crm.contact.search", parameters: { q: "test" } };
    const ctx = { organizationId: "org-1" };

    await executor.execute(action, ctx, bridge);
    await executor.execute(action, ctx, bridge);

    expect(handler).toHaveBeenCalledTimes(2); // No dedup for reads
  });

  it("works without idempotency guard (backwards compatible)", async () => {
    const executor = new ActionExecutor();
    const handler = vi.fn().mockResolvedValue({ success: true });
    executor.register("test.action", handler);

    const bridge = new PolicyBridge(null);
    const result = await executor.execute(
      { actionType: "test.action", parameters: {} },
      { organizationId: "org-1" },
      bridge,
    );

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/agents test -- --run action-executor
```

Expected: FAIL — `ActionExecutor` constructor doesn't accept config.

- [ ] **Step 3: Implement idempotency in ActionExecutor**

Modify `packages/agents/src/action-executor.ts`:

```typescript
import type { AgentContext, ActionRequest } from "./ports.js";
import type { PolicyBridge } from "./policy-bridge.js";

export type ActionHandler = (
  parameters: Record<string, unknown>,
  context: AgentContext,
) => Promise<{ success: boolean; result?: unknown }>;

export interface ActionResult {
  actionType: string;
  success: boolean;
  blockedByPolicy: boolean;
  result?: unknown;
  error?: string;
}

export interface ActionExecutorConfig {
  idempotencyGuard?: {
    checkDuplicate(
      principalId: string,
      actionType: string,
      parameters: Record<string, unknown>,
    ): Promise<{ isDuplicate: boolean; cachedResponse: unknown | null }>;
    recordResponse(
      principalId: string,
      actionType: string,
      parameters: Record<string, unknown>,
      response: unknown,
    ): Promise<void>;
  };
  writeActions?: Set<string>;
}

export class ActionExecutor {
  private handlers = new Map<string, ActionHandler>();
  private idempotencyGuard: ActionExecutorConfig["idempotencyGuard"];
  private writeActions: Set<string>;

  constructor(config?: ActionExecutorConfig) {
    this.idempotencyGuard = config?.idempotencyGuard;
    this.writeActions = config?.writeActions ?? new Set();
  }

  register(actionType: string, handler: ActionHandler): void {
    this.handlers.set(actionType, handler);
  }

  listRegistered(): string[] {
    return [...this.handlers.keys()];
  }

  async execute(
    action: ActionRequest,
    context: AgentContext,
    policyBridge: PolicyBridge,
  ): Promise<ActionResult> {
    const handler = this.handlers.get(action.actionType);
    if (!handler) {
      return {
        actionType: action.actionType,
        success: false,
        blockedByPolicy: false,
        error: `No handler registered for action type: ${action.actionType}`,
      };
    }

    const evaluation = await policyBridge.evaluate({
      eventId: "action-" + action.actionType,
      destinationType: "system",
      destinationId: action.actionType,
      action: action.actionType,
      payload: action.parameters,
      criticality: "required",
    });

    if (!evaluation.approved) {
      return {
        actionType: action.actionType,
        success: false,
        blockedByPolicy: true,
        error: evaluation.reason,
      };
    }

    // Idempotency check for write actions
    const isWrite = this.writeActions.has(action.actionType);
    if (isWrite && this.idempotencyGuard) {
      const principalId = context.organizationId;
      const { isDuplicate, cachedResponse } = await this.idempotencyGuard.checkDuplicate(
        principalId,
        action.actionType,
        action.parameters,
      );
      if (isDuplicate && cachedResponse) {
        const cached = cachedResponse as ActionResult;
        return cached;
      }
    }

    try {
      const result = await handler(action.parameters, context);
      const actionResult: ActionResult = {
        actionType: action.actionType,
        success: result.success,
        blockedByPolicy: false,
        result: result.result,
      };

      // Record for future dedup
      if (isWrite && this.idempotencyGuard) {
        await this.idempotencyGuard.recordResponse(
          context.organizationId,
          action.actionType,
          action.parameters,
          actionResult,
        );
      }

      return actionResult;
    } catch (err) {
      return {
        actionType: action.actionType,
        success: false,
        blockedByPolicy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/agents test -- --run action-executor
```

Expected: PASS — all existing + new tests.

- [ ] **Step 5: Run full agents test suite**

```bash
pnpm --filter @switchboard/agents test -- --run
```

Expected: PASS — constructor change is backwards compatible (optional config).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/action-executor.ts packages/agents/src/__tests__/action-executor.test.ts
git commit -m "fix(agents): add idempotency guard to ActionExecutor for write operations"
```

---

## Task 6: Notification Classifier

**Files:**

- Create: `packages/core/src/notifications/__tests__/notification-classifier.test.ts`
- Create: `packages/core/src/notifications/notification-classifier.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/notifications/__tests__/notification-classifier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyNotification } from "../notification-classifier.js";
import type { NotificationEvent, TrustLevel } from "../notification-classifier.js";

describe("classifyNotification", () => {
  // T1 — Act Now
  it("classifies pending_approval as T1", () => {
    const event: NotificationEvent = { type: "pending_approval", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T1");
  });

  it("classifies action_failed as T1", () => {
    const event: NotificationEvent = { type: "action_failed", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T1");
  });

  it("classifies escalation as T1", () => {
    const event: NotificationEvent = { type: "escalation", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T1");
  });

  it("classifies revenue_event as T1", () => {
    const event: NotificationEvent = { type: "revenue_event", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T1");
  });

  // T2 — Confirm
  it("classifies fact_learned as T2", () => {
    const event: NotificationEvent = { type: "fact_learned", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T2");
  });

  it("classifies faq_drafted as T2", () => {
    const event: NotificationEvent = { type: "faq_drafted", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T2");
  });

  it("classifies agent_contradicted as T2", () => {
    const event: NotificationEvent = {
      type: "agent_contradicted",
      deploymentId: "d1",
      metadata: {},
    };
    expect(classifyNotification(event)).toBe("T2");
  });

  // T3 — FYI
  it("classifies weekly_summary as T3", () => {
    const event: NotificationEvent = { type: "weekly_summary", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T3");
  });

  it("classifies milestone as T3", () => {
    const event: NotificationEvent = { type: "milestone", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T3");
  });

  it("classifies unknown event type as T3 (safe default)", () => {
    const event: NotificationEvent = {
      type: "something_else" as NotificationEvent["type"],
      deploymentId: "d1",
      metadata: {},
    };
    expect(classifyNotification(event)).toBe("T3");
  });

  // Trust level modifiers
  it("upgrades T2 to T1 at observe trust level", () => {
    const event: NotificationEvent = { type: "fact_learned", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event, "observe")).toBe("T1");
  });

  it("keeps T1 as T1 at autonomous trust level", () => {
    const event: NotificationEvent = { type: "pending_approval", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event, "autonomous")).toBe("T1");
  });

  it("downgrades T2 to T3 at autonomous trust level", () => {
    const event: NotificationEvent = { type: "fact_learned", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event, "autonomous")).toBe("T3");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- --run notification-classifier
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement notification classifier**

Create `packages/core/src/notifications/notification-classifier.ts`:

```typescript
// ---------------------------------------------------------------------------
// Notification Classifier — event type + metadata → T1/T2/T3 tier
// ---------------------------------------------------------------------------

export type NotificationTier = "T1" | "T2" | "T3";

export type TrustLevel = "observe" | "guarded" | "autonomous";

export type NotificationEventType =
  | "pending_approval"
  | "action_failed"
  | "escalation"
  | "revenue_event"
  | "fact_learned"
  | "faq_drafted"
  | "agent_contradicted"
  | "weekly_summary"
  | "milestone"
  | "performance_stats";

export interface NotificationEvent {
  type: NotificationEventType;
  deploymentId: string;
  metadata: Record<string, unknown>;
}

const T1_EVENTS: ReadonlySet<string> = new Set([
  "pending_approval",
  "action_failed",
  "escalation",
  "revenue_event",
]);

const T2_EVENTS: ReadonlySet<string> = new Set([
  "fact_learned",
  "faq_drafted",
  "agent_contradicted",
]);

/**
 * Classify a notification event into a tier.
 *
 * Trust level modifiers affect T2 events only:
 * - `observe`: upgrades T2 → T1 (owner sees everything)
 * - `autonomous`: downgrades T2 → T3 (facts auto-confirm)
 *
 * T1 events are never downgraded. The trust graduation table in the spec
 * (Section 4.3) describes what TRIGGERS T1 events upstream (e.g., at
 * `autonomous`, fewer actions generate `pending_approval`). Once a T1 event
 * fires, it's always urgent regardless of trust level.
 *
 * @param event - The notification event to classify
 * @param trustLevel - Optional trust level modifier (defaults to "guarded")
 * @returns The notification tier: T1 (Act Now), T2 (Confirm), T3 (FYI)
 */
export function classifyNotification(
  event: NotificationEvent,
  trustLevel: TrustLevel = "guarded",
): NotificationTier {
  // Base classification from event type
  let tier: NotificationTier;
  if (T1_EVENTS.has(event.type)) {
    tier = "T1";
  } else if (T2_EVENTS.has(event.type)) {
    tier = "T2";
  } else {
    tier = "T3";
  }

  // Trust level modifiers
  if (trustLevel === "observe" && tier === "T2") {
    return "T1";
  }

  if (trustLevel === "autonomous" && tier === "T2") {
    return "T3";
  }

  return tier;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/core test -- --run notification-classifier
```

Expected: PASS — all 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/notifications/notification-classifier.ts packages/core/src/notifications/__tests__/notification-classifier.test.ts
git commit -m "feat(core): add notification tier classifier — event type + trust level → T1/T2/T3"
```

---

## Task 7: Notification Batcher

**Files:**

- Create: `packages/core/src/notifications/__tests__/notification-batcher.test.ts`
- Create: `packages/core/src/notifications/notification-batcher.ts`

**Reference:** `ProactiveSender` is at `packages/core/src/notifications/proactive-sender.ts` with interface `AgentNotifier { sendProactive(chatId, channelType, message): Promise<void> }`.

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/notifications/__tests__/notification-batcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotificationBatcher } from "../notification-batcher.js";
import type { NotificationEvent } from "../notification-classifier.js";

describe("NotificationBatcher", () => {
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sendFn = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes when batch reaches maxBatchSize", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 20 * 60 * 1000,
      maxBatchSize: 3,
    });

    const event: NotificationEvent = { type: "fact_learned", deploymentId: "d1", metadata: {} };
    batcher.add(event);
    batcher.add(event);
    expect(sendFn).not.toHaveBeenCalled();

    batcher.add(event);
    // Should have flushed after 3rd event
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith("d1", expect.any(Array));
    expect(sendFn.mock.calls[0][1]).toHaveLength(3);

    batcher.stop();
  });

  it("flushes on timer interval", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 1000, // 1s for test speed
      maxBatchSize: 10,
    });

    const event: NotificationEvent = { type: "faq_drafted", deploymentId: "d1", metadata: {} };
    batcher.add(event);

    expect(sendFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][1]).toHaveLength(1);

    batcher.stop();
  });

  it("batches per deployment", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 20 * 60 * 1000,
      maxBatchSize: 2,
    });

    batcher.add({ type: "fact_learned", deploymentId: "d1", metadata: {} });
    batcher.add({ type: "fact_learned", deploymentId: "d2", metadata: {} });
    expect(sendFn).not.toHaveBeenCalled(); // Different deployments

    batcher.add({ type: "faq_drafted", deploymentId: "d1", metadata: {} });
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith("d1", expect.any(Array));

    batcher.stop();
  });

  it("does not flush when empty on timer tick", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 1000,
      maxBatchSize: 10,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sendFn).not.toHaveBeenCalled();

    batcher.stop();
  });

  it("stop() clears the interval timer", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 1000,
      maxBatchSize: 10,
    });

    batcher.add({ type: "fact_learned", deploymentId: "d1", metadata: {} });
    batcher.stop();

    await vi.advanceTimersByTimeAsync(2000);
    expect(sendFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- --run notification-batcher
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement notification batcher**

Create `packages/core/src/notifications/notification-batcher.ts`:

```typescript
// ---------------------------------------------------------------------------
// Notification Batcher — accumulates T2 events, flushes on count or timer
// ---------------------------------------------------------------------------

import type { NotificationEvent } from "./notification-classifier.js";

export interface NotificationBatcherConfig {
  /** Called when a batch flushes. Receives deploymentId and accumulated events. */
  onFlush: (deploymentId: string, events: NotificationEvent[]) => void | Promise<void>;
  /** Flush interval in ms (default: 20 minutes). */
  flushIntervalMs?: number;
  /** Max events per deployment before flush (default: 3). */
  maxBatchSize?: number;
}

export class NotificationBatcher {
  private batches = new Map<string, NotificationEvent[]>();
  private onFlush: NotificationBatcherConfig["onFlush"];
  private maxBatchSize: number;
  private timer: ReturnType<typeof setInterval>;

  constructor(config: NotificationBatcherConfig) {
    this.onFlush = config.onFlush;
    this.maxBatchSize = config.maxBatchSize ?? 3;
    const intervalMs = config.flushIntervalMs ?? 20 * 60 * 1000;
    this.timer = setInterval(() => this.flushAll(), intervalMs);
  }

  add(event: NotificationEvent): void {
    const batch = this.batches.get(event.deploymentId) ?? [];
    batch.push(event);
    this.batches.set(event.deploymentId, batch);

    if (batch.length >= this.maxBatchSize) {
      this.flush(event.deploymentId);
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.batches.clear();
  }

  private flush(deploymentId: string): void {
    const batch = this.batches.get(deploymentId);
    if (!batch || batch.length === 0) return;

    this.batches.delete(deploymentId);
    this.onFlush(deploymentId, batch);
  }

  private flushAll(): void {
    for (const deploymentId of [...this.batches.keys()]) {
      this.flush(deploymentId);
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/core test -- --run notification-batcher
```

Expected: PASS — all 5 tests.

- [ ] **Step 5: Update notifications barrel**

In `packages/core/src/notifications/index.ts`, add:

```typescript
export { classifyNotification } from "./notification-classifier.js";
export type {
  NotificationTier,
  TrustLevel,
  NotificationEvent,
  NotificationEventType,
} from "./notification-classifier.js";
export { NotificationBatcher } from "./notification-batcher.js";
export type { NotificationBatcherConfig } from "./notification-batcher.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/notifications/notification-batcher.ts packages/core/src/notifications/__tests__/notification-batcher.test.ts packages/core/src/notifications/index.ts
git commit -m "feat(core): add notification batcher — T2 event accumulation with timer/count flush"
```

---

## Task 8: Full Integration Verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

Expected: PASS — all packages.

- [ ] **Step 2: Type check**

```bash
pnpm typecheck
```

Expected: PASS — no type errors.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: PASS — no lint errors.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: PASS — all packages build.

- [ ] **Step 5: Final commit (if any lint/format fixes needed)**

```bash
git add -A
git commit -m "chore: lint and format fixes for governance hardening"
```
