import { describe, it, expect, beforeEach } from "vitest";
import { SkillMode } from "../modes/skill-mode.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionContext } from "../execution-context.js";
import type {
  SkillExecutor,
  SkillDefinition,
  SkillExecutionResult,
  SkillExecutionParams,
} from "../../skill-runtime/types.js";

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "Sales Pipeline",
    slug: "sales-pipeline",
    version: "1.0.0",
    description: "Run the sales pipeline",
    author: "test",
    parameters: [],
    tools: ["crm.read"],
    body: "Do something useful",
    context: [],
    intent: "sales-pipeline.run",
    ...overrides,
  };
}

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    intent: "sales-pipeline.run",
    parameters: {},
    resolvedMode: "skill",
    traceId: "trace-abc",
    trigger: "chat",
    priority: "normal",
    ...overrides,
  };
}

const defaultConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default", "premium"],
  maxToolCalls: 10,
  maxLlmTurns: 8,
  maxTotalTokens: 50_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

const defaultContext: ExecutionContext = {
  traceId: "trace-abc",
  governanceDecision: {
    outcome: "execute",
    riskScore: 0.2,
    budgetProfile: "standard",
    constraints: defaultConstraints,
    matchedPolicies: [],
  },
};

function makeSuccessResult(): SkillExecutionResult {
  return {
    response: "Pipeline processed 3 leads",
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 1200,
      turnCount: 2,
      status: "success",
      responseSummary: "Processed 3 leads successfully",
      writeCount: 0,
      governanceDecisions: [],
    },
  };
}

class MockExecutor implements SkillExecutor {
  lastParams?: SkillExecutionParams;
  result: SkillExecutionResult = makeSuccessResult();
  shouldThrow = false;
  errorMessage = "executor boom";

  async execute(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    this.lastParams = params;
    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }
    return this.result;
  }
}

describe("SkillMode", () => {
  let executor: MockExecutor;
  let skill: SkillDefinition;
  let mode: SkillMode;

  beforeEach(() => {
    executor = new MockExecutor();
    skill = makeSkill();
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    mode = new SkillMode({ executor, skillsBySlug });
  });

  it("executes skill and returns completed ExecutionResult", async () => {
    const workUnit = makeWorkUnit();
    const result = await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(result.outcome).toBe("completed");
    expect(result.workUnitId).toBe("wu-1");
    expect(result.mode).toBe("skill");
    expect(result.summary).toBe("Processed 3 leads successfully");
    expect(result.outputs).toEqual({
      response: "Pipeline processed 3 leads",
      toolCalls: [],
    });
  });

  it("returns failed outcome when skill not found", async () => {
    const workUnit = makeWorkUnit({ intent: "unknown.run" });
    const result = await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("SKILL_NOT_FOUND");
    expect(result.error?.message).toContain("unknown");
  });

  it("returns failed outcome when executor throws", async () => {
    executor.shouldThrow = true;
    const workUnit = makeWorkUnit();
    const result = await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("EXECUTION_ERROR");
    expect(result.error?.message).toBe("executor boom");
  });

  it("maps durationMs and traceId correctly", async () => {
    const workUnit = makeWorkUnit();
    const result = await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(result.traceId).toBe("trace-abc");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves skill slug from intent", async () => {
    const workUnit = makeWorkUnit({ intent: "sales-pipeline.run" });
    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(executor.lastParams?.skill.slug).toBe("sales-pipeline");
  });
});
