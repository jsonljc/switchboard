// EV-10 — skill-runtime constraints-drop tripwire (SPINE-3 / BUG-3) + prod-inert
// matrix (SPINE-4). Deterministic core unit tests: no LLM, no API key.
//
// These tests PIN EXISTING behavior. They change NO production code. Two groups:
//
//   SPINE-3 is a deliberate TRIPWIRE, NOT a desired end-state. The skill-runtime
//   governance `constraints` (maxToolCalls, maxWritesPerExecution, …) are the
//   gate's per-execution regime, but they are DROPPED at the SkillMode→executor
//   seam: skill-mode.ts forwards only `trustLevel`, and the executor enforces its
//   OWN SkillRuntimePolicy instead (the "two constraint regimes" reality — the gov
//   constraints never reach the executor). We pin that drop so that if someone
//   later wires the constraints into the executor policy, THESE TESTS FAIL — making
//   the change a reviewed, intentional event rather than a silent behavior shift.
//
//   SPINE-4 pins that an auto-execute cron-intent is prod-INERT (it silently does
//   nothing) unless EVERY leg is satisfied — schedule trigger, PLATFORM_DIRECT
//   deployment, allow-listed governance, a seeded `system` actor, and a registered
//   operator-mutation handler. Each missing leg produces its own specific failure
//   code at the canonical `PlatformIngress.submit()` chokepoint; a baseline test
//   anchors that all-legs-present executes, so each negative flips exactly one leg.

import { describe, it, expect, vi } from "vitest";

import { SkillMode } from "../modes/skill-mode.js";
import { OperatorMutationMode } from "../modes/operator-mutation-mode.js";
import type { OperatorMutationHandler } from "../modes/operator-mutation-mode.js";
import { PlatformIngress } from "../platform-ingress.js";
import type { GovernanceGateInterface } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import { SkillExecutorImpl } from "../../skill-runtime/skill-executor.js";
import { DEFAULT_SKILL_RUNTIME_POLICY } from "../../skill-runtime/types.js";
import { ok } from "../../skill-runtime/tool-result.js";
import type {
  ToolCallingLLMAdapter,
  LLMContentBlock,
  LLMStopReason,
} from "../../skill-runtime/llm-types.js";
import type {
  SkillExecutor,
  SkillDefinition,
  SkillExecutionResult,
  SkillExecutionParams,
  SkillTool,
} from "../../skill-runtime/types.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionConstraints, GovernanceDecision } from "../governance-types.js";
import type { ExecutionContext } from "../execution-context.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { Actor, Trigger } from "../types.js";
import type { CanonicalSubmitRequest } from "../canonical-request.js";

// ---------------------------------------------------------------------------
// SPINE-3 — constraints-drop tripwire (skill-runtime)
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "Cron Skill",
    slug: "cron-skill",
    version: "1.0.0",
    description: "A skill with a write tool",
    author: "test",
    parameters: [],
    tools: [],
    body: "Do the thing.",
    context: [],
    intent: "cron-skill.run",
    ...overrides,
  };
}

function makeSkillWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "system", type: "system" },
    intent: "cron-skill.run",
    parameters: {},
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "cron-skill",
      trustLevel: "guided",
      trustScore: 42,
    },
    resolvedMode: "skill",
    traceId: "trace-abc",
    trigger: "schedule",
    priority: "normal",
    ...overrides,
  };
}

// Governance constraints that try to cap the execution to ONE tool call and ONE
// write. They are intentionally tighter than DEFAULT_SKILL_RUNTIME_POLICY so the
// drop is observable: the executor runs to its own policy ceiling, not this one.
const govConstraintsMax1: ExecutionConstraints = {
  allowedModelTiers: ["default", "premium"],
  maxToolCalls: 1,
  maxLlmTurns: 8,
  maxTotalTokens: 50_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 1,
  trustLevel: "guided",
};

const skillContext: ExecutionContext = {
  traceId: "trace-abc",
  governanceDecision: {
    outcome: "execute",
    riskScore: 0.2,
    budgetProfile: "standard",
    constraints: govConstraintsMax1,
    matchedPolicies: [],
  },
};

function makeSuccessResult(): SkillExecutionResult {
  return {
    response: "ok",
    toolCalls: [],
    tokenUsage: { input: 10, output: 5 },
    trace: {
      durationMs: 1,
      turnCount: 1,
      status: "success",
      responseSummary: "ok",
      writeCount: 0,
      governanceDecisions: [],
      qualificationSignals: null,
    },
  };
}

/** Records the params SkillMode forwards so we can inspect what crossed the seam. */
class RecordingExecutor implements SkillExecutor {
  lastParams?: SkillExecutionParams;
  async execute(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    this.lastParams = params;
    return makeSuccessResult();
  }
}

function createMockAdapter(
  responses: Array<{ content: LLMContentBlock[]; stopReason: LLMStopReason }>,
): ToolCallingLLMAdapter {
  let i = 0;
  return {
    chatWithTools: vi.fn(async () => {
      const r = responses[i++]!;
      return {
        content: r.content,
        stopReason: r.stopReason,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }),
  };
}

/** A fresh write-effect tool per call (own vi.fn, no shared state). */
function makeWriteTool(): SkillTool {
  return {
    id: "crm-write",
    operations: {
      do: {
        description: "write something",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "write",
        execute: vi.fn().mockResolvedValue(ok({ ok: true })),
      },
    },
  };
}

/** Two write tool calls in one assistant turn, then end the conversation. */
function twoWriteCallsThenEnd(): Array<{ content: LLMContentBlock[]; stopReason: LLMStopReason }> {
  return [
    {
      content: [
        { type: "tool_use", id: "t1", name: "crm-write.do", input: {} },
        { type: "tool_use", id: "t2", name: "crm-write.do", input: {} },
      ],
      stopReason: "tool_use",
    },
    { content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
  ];
}

describe("EV-10 SPINE-3: skill-runtime governance constraints are dropped at the executor seam (TRIPWIRE — pins current non-wired behavior, NOT a desired end-state)", () => {
  it("structural: SkillMode forwards only trustLevel — maxToolCalls/maxWritesPerExecution never reach the executor", async () => {
    const executor = new RecordingExecutor();
    const skill = makeSkill();
    const mode = new SkillMode({
      executor,
      skillsBySlug: new Map([[skill.slug, skill]]),
    });

    await mode.execute(makeSkillWorkUnit(), govConstraintsMax1, skillContext);

    const passed = executor.lastParams!;
    // trustLevel is the ONLY field of ExecutionConstraints that crosses into
    // SkillExecutionParams (skill-mode.ts ~line 93).
    expect(passed.trustLevel).toBe(govConstraintsMax1.trustLevel);
    // The resource constraints are dropped — they are not even present on the
    // SkillExecutionParams the executor receives, so the executor cannot honor
    // them. This is the "two constraint regimes" seam.
    expect(passed).not.toHaveProperty("maxToolCalls");
    expect(passed).not.toHaveProperty("maxWritesPerExecution");
    expect(passed).not.toHaveProperty("maxLlmTurns");
    expect(passed).not.toHaveProperty("maxTotalTokens");
  });

  it("tripwire: a default-policy executor runs MORE than governance maxToolCalls:1 — it executes 2 tool calls", async () => {
    // Real executor with the DEFAULT policy (maxToolCalls: 5). The governance
    // constraint of 1 is dropped, so the executor's own ceiling applies and both
    // tool calls run. If constraints were ever wired into policy, this would throw
    // a budget error after the first call and the assertion below would fail.
    const executor = new SkillExecutorImpl(
      createMockAdapter(twoWriteCallsThenEnd()),
      new Map([["crm-write", makeWriteTool()]]),
      undefined,
      [],
      DEFAULT_SKILL_RUNTIME_POLICY,
    );
    const skill = makeSkill({ tools: ["crm-write"] });
    const mode = new SkillMode({ executor, skillsBySlug: new Map([[skill.slug, skill]]) });

    const workUnit = makeSkillWorkUnit({
      parameters: { conversation: { messages: [{ role: "user", content: "go" }] } },
    });
    const result = await mode.execute(workUnit, govConstraintsMax1, skillContext);

    expect(result.outcome).toBe("completed");
    const toolCalls = result.outputs.toolCalls as unknown[];
    // 2 > governance maxToolCalls (1): the constraint is NOT enforced.
    expect(toolCalls).toHaveLength(2);
    expect(govConstraintsMax1.maxToolCalls).toBe(1);
  });

  it("tripwire: governance maxWritesPerExecution:1 does not bound writes — 2 writes commit", async () => {
    // Drive the real executor directly so we can read trace.writeCount (SkillMode
    // surfaces toolCalls but not the write count). The executor receives no
    // maxWritesPerExecution at all, AND its own policy.maxWritesPerExecution is
    // never enforced inside the loop — so both writes commit.
    const executor = new SkillExecutorImpl(
      createMockAdapter(twoWriteCallsThenEnd()),
      new Map([["crm-write", makeWriteTool()]]),
      undefined,
      [],
      DEFAULT_SKILL_RUNTIME_POLICY,
    );

    const result = await executor.execute({
      skill: makeSkill({ tools: ["crm-write"] }),
      parameters: {},
      messages: [{ role: "user", content: "go" }],
      deploymentId: "dep-1",
      orgId: "org-1",
      trustScore: 42,
      trustLevel: "guided",
    });

    expect(result.trace.status).toBe("success");
    // 2 writes > governance maxWritesPerExecution (1): writes are unbounded by it.
    expect(result.trace.writeCount).toBe(2);
    expect(govConstraintsMax1.maxWritesPerExecution).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SPINE-4 — prod-inert matrix (auto-execute cron-intent)
// ---------------------------------------------------------------------------

// A representative auto-execute cron-intent: the weekly report delivery, which is
// registered operator_mutation + system_auto_approved with a "schedule" trigger
// (apps/api bootstrap/operator-intents.ts). The matrix below pins, at the core
// PlatformIngress.submit() chokepoint, that it is inert unless every leg is met.
const CRON_INTENT = "ledger.deliver_weekly_report";
const SEEDED_SYSTEM_ACTOR: Actor = { id: "system", type: "system" };

// The governance constraints carried by an allow decision (consumed by dispatch;
// the operator_mutation handler ignores them, but the type requires them present).
const cronConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 2,
  trustLevel: "autonomous",
};

function executeDecision(): GovernanceDecision {
  return {
    outcome: "execute",
    riskScore: 0.1,
    budgetProfile: "cheap",
    constraints: cronConstraints,
    matchedPolicies: ["auto-exec-allowlist"],
  };
}

function denyDecision(reasonCode: string): GovernanceDecision {
  return { outcome: "deny", reasonCode, riskScore: 1, matchedPolicies: [] };
}

function cronRegistration(overrides: Partial<IntentRegistration> = {}): IntentRegistration {
  return {
    intent: CRON_INTENT,
    defaultMode: "operator_mutation",
    allowedModes: ["operator_mutation"],
    executor: { mode: "operator_mutation" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
    idempotent: true,
    allowedTriggers: ["schedule", "api"],
    timeoutMs: 30_000,
    retryable: false,
    ...overrides,
  };
}

function cronRequest(overrides: Partial<CanonicalSubmitRequest> = {}): CanonicalSubmitRequest {
  return {
    organizationId: "org-1",
    actor: SEEDED_SYSTEM_ACTOR,
    intent: CRON_INTENT,
    parameters: {},
    trigger: "schedule",
    surface: { surface: "api", requestId: "cron-weekly" },
    ...overrides,
  };
}

function completedHandler(): OperatorMutationHandler {
  return {
    execute: async () => ({
      outcome: "completed",
      summary: "weekly report delivered",
      outputs: { delivered: true },
    }),
  };
}

/**
 * Build a PlatformIngress wired for the cron-intent, flipping exactly one leg via
 * opts. Defaults are the all-legs-present baseline: schedule trigger allowed,
 * governance allows, deployment resolves, a handler is registered.
 */
function createCronIngress(
  opts: {
    allowedTriggers?: Trigger[];
    governance?: "execute" | "deny" | "throw";
    denyReasonCode?: string;
    deploymentThrows?: boolean;
    withHandler?: boolean;
  } = {},
): PlatformIngress {
  const intentRegistry = new IntentRegistry();
  // Only override allowedTriggers when explicitly provided; passing undefined
  // through would clobber the ["schedule", "api"] default.
  intentRegistry.register(
    opts.allowedTriggers
      ? cronRegistration({ allowedTriggers: opts.allowedTriggers })
      : cronRegistration(),
  );

  const handlers = new Map<string, OperatorMutationHandler>();
  if (opts.withHandler !== false) handlers.set(CRON_INTENT, completedHandler());
  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(new OperatorMutationMode({ handlers }));

  const governance = opts.governance ?? "execute";
  const governanceGate: GovernanceGateInterface = {
    evaluate:
      governance === "throw"
        ? // A bespoke `system:<x>` actor with NO seeded IdentitySpec makes
          // GovernanceGate.loadIdentitySpec(actor.id) throw "Identity spec not
          // found"; submit() catches it as GOVERNANCE_ERROR. Modeled here as a gate
          // rejection (the gate is the seam where identity resolution happens).
          vi.fn().mockRejectedValue(new Error("Identity spec not found: system:weekly-report"))
        : governance === "deny"
          ? vi
              .fn()
              .mockResolvedValue(denyDecision(opts.denyReasonCode ?? "AUTO_EXEC_NOT_ALLOWLISTED"))
          : vi.fn().mockResolvedValue(executeDecision()),
  };

  const deploymentResolver = {
    resolve: opts.deploymentThrows
      ? vi.fn().mockRejectedValue(new Error("no PLATFORM_DIRECT deployment for org"))
      : vi.fn().mockResolvedValue({
          deploymentId: "platform-direct",
          skillSlug: "platform-direct",
          trustLevel: "autonomous",
          trustScore: 100,
        }),
  };

  return new PlatformIngress({ intentRegistry, modeRegistry, governanceGate, deploymentResolver });
}

describe("EV-10 SPINE-4: an auto-execute cron-intent is prod-INERT unless every leg is satisfied", () => {
  it("baseline: all legs present (schedule trigger + PLATFORM_DIRECT + allow-gov + seeded system actor + handler) → completed", async () => {
    const ingress = createCronIngress();
    const res = await ingress.submit(cronRequest());

    expect(res.ok).toBe(true);
    if (res.ok && "approvalRequired" in res === false) {
      expect(res.result.outcome).toBe("completed");
      expect(res.result.outputs).toEqual({ delivered: true });
    }
  });

  it("leg — unseeded intent: resolveMode throws, and submit of an unregistered cron-intent is inert (intent_not_found)", async () => {
    // resolveMode itself throws on an unseeded slug — the prod-inert root cause.
    const registry = new IntentRegistry();
    expect(() => registry.resolveMode("cron.never-registered")).toThrow(/Intent not registered/);

    // End-to-end the same intent fails closed at the earlier intent lookup, so the
    // cron silently no-ops rather than executing an unknown action.
    const ingress = createCronIngress();
    const res = await ingress.submit(cronRequest({ intent: "cron.never-registered" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.type).toBe("intent_not_found");
  });

  it("leg — missing schedule trigger: submit on trigger 'schedule' when not in allowedTriggers → trigger_not_allowed", async () => {
    const ingress = createCronIngress({ allowedTriggers: ["api"] }); // no "schedule"
    const res = await ingress.submit(cronRequest({ trigger: "schedule" }));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe("trigger_not_allowed");
      expect(res.error.intent).toBe(CRON_INTENT);
    }
  });

  it("leg — missing PLATFORM_DIRECT deployment: resolver throws → deployment_not_found", async () => {
    const ingress = createCronIngress({ deploymentThrows: true });
    const res = await ingress.submit(cronRequest());

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe("deployment_not_found");
      expect(res.error.intent).toBe(CRON_INTENT);
    }
  });

  it("leg — governance not allow-listed: deny → failed result carrying the deny reasonCode", async () => {
    const ingress = createCronIngress({
      governance: "deny",
      denyReasonCode: "AUTO_EXEC_NOT_ALLOWLISTED",
    });
    const res = await ingress.submit(cronRequest());

    expect(res.ok).toBe(true);
    if (res.ok && "approvalRequired" in res === false) {
      expect(res.result.outcome).toBe("failed");
      expect(res.result.error?.code).toBe("AUTO_EXEC_NOT_ALLOWLISTED");
    }
  });

  it("leg — unseeded system actor: identity-spec resolution throws in the gate → failed GOVERNANCE_ERROR (the silent no-op)", async () => {
    // A bespoke `system:weekly-report` actor id has no seeded IdentitySpec, so the
    // gate's loadIdentitySpec throws → submit() surfaces a failed GOVERNANCE_ERROR
    // result (NOT a clean execute). A caller reading outputs.delivered sees
    // undefined and the action silently never happens.
    const ingress = createCronIngress({ governance: "throw" });
    const res = await ingress.submit(
      cronRequest({ actor: { id: "system:weekly-report", type: "system" } }),
    );

    expect(res.ok).toBe(true);
    if (res.ok && "approvalRequired" in res === false) {
      expect(res.result.outcome).toBe("failed");
      expect(res.result.error?.code).toBe("GOVERNANCE_ERROR");
    }
  });

  it("leg — missing operator-mutation handler: dispatch finds none → failed OPERATOR_MUTATION_NOT_REGISTERED", async () => {
    const ingress = createCronIngress({ withHandler: false });
    const res = await ingress.submit(cronRequest());

    expect(res.ok).toBe(true);
    if (res.ok && "approvalRequired" in res === false) {
      expect(res.result.outcome).toBe("failed");
      expect(res.result.error?.code).toBe("OPERATOR_MUTATION_NOT_REGISTERED");
    }
  });
});
