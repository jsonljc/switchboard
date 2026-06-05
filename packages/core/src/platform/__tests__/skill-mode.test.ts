import { describe, it, expect, beforeEach, vi } from "vitest";
import { SkillMode } from "../modes/skill-mode.js";
import { BuilderRegistry } from "../../skill-runtime/builder-registry.js";
import type { BuilderContext } from "../../skill-runtime/builder-registry.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionContext } from "../execution-context.js";
import type {
  SkillExecutor,
  SkillDefinition,
  SkillExecutionResult,
  SkillExecutionParams,
} from "../../skill-runtime/types.js";
import type { ContextRequirement } from "@switchboard/schemas";

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
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "sales-pipeline",
      trustLevel: "guided",
      trustScore: 42,
    },
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
      qualificationSignals: null,
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
    const workUnit = makeWorkUnit({
      intent: "unknown.run",
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "unknown",
        trustLevel: "guided",
        trustScore: 42,
      },
    });
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

describe("SkillMode with BuilderRegistry", () => {
  let executor: MockExecutor;
  let skill: SkillDefinition;
  let builderRegistry: BuilderRegistry;

  beforeEach(() => {
    executor = new MockExecutor();
    skill = makeSkill();
    builderRegistry = new BuilderRegistry();
  });

  it("runs builder when registered and passes enriched parameters to executor", async () => {
    builderRegistry.register("sales-pipeline", async (_ctx: BuilderContext) => ({
      BUSINESS_NAME: "Test Co",
      LEAD_PROFILE: { name: "Jane" },
    }));

    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({
      executor,
      skillsBySlug,
      builderRegistry,
      stores: {
        opportunityStore: { findActiveByContact: vi.fn().mockResolvedValue([]) },
        contactStore: { findById: vi.fn().mockResolvedValue(null) },
        activityStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      },
    });

    const workUnit = makeWorkUnit();
    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(executor.lastParams?.parameters).toEqual({
      BUSINESS_NAME: "Test Co",
      LEAD_PROFILE: { name: "Jane" },
    });
  });

  it("threads injectedPatternIds from rich builder result onto ExecutionResult", async () => {
    builderRegistry.register("sales-pipeline", async (_ctx: BuilderContext) => ({
      parameters: { BUSINESS_NAME: "Test Co" },
      metadata: { injectedPatternIds: ["pat_a", "pat_b"] },
    }));

    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({
      executor,
      skillsBySlug,
      builderRegistry,
      stores: {
        opportunityStore: { findActiveByContact: vi.fn().mockResolvedValue([]) },
        contactStore: { findById: vi.fn().mockResolvedValue(null) },
        activityStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      },
    });

    const workUnit = makeWorkUnit();
    const result = await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(executor.lastParams?.parameters).toEqual({ BUSINESS_NAME: "Test Co" });
    expect(result.injectedPatternIds).toEqual(["pat_a", "pat_b"]);
  });

  it("defaults injectedPatternIds to [] for builders that return the flat shape", async () => {
    builderRegistry.register("sales-pipeline", async (_ctx: BuilderContext) => ({
      BUSINESS_NAME: "Flat Co",
    }));

    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({
      executor,
      skillsBySlug,
      builderRegistry,
      stores: {
        opportunityStore: { findActiveByContact: vi.fn().mockResolvedValue([]) },
        contactStore: { findById: vi.fn().mockResolvedValue(null) },
        activityStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      },
    });

    const workUnit = makeWorkUnit();
    const result = await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(executor.lastParams?.parameters).toEqual({ BUSINESS_NAME: "Flat Co" });
    expect(result.injectedPatternIds).toEqual([]);
  });

  it("passes through workUnit.parameters when no builder is registered", async () => {
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({
      executor,
      skillsBySlug,
      builderRegistry,
      stores: {
        opportunityStore: { findActiveByContact: vi.fn().mockResolvedValue([]) },
        contactStore: { findById: vi.fn().mockResolvedValue(null) },
        activityStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      },
    });

    const workUnit = makeWorkUnit({ parameters: { raw: "data" } });
    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(executor.lastParams?.parameters).toEqual({ raw: "data" });
  });

  it("reads skillSlug from workUnit.deployment.skillSlug", async () => {
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({
      executor,
      skillsBySlug,
      builderRegistry,
      stores: {
        opportunityStore: { findActiveByContact: vi.fn().mockResolvedValue([]) },
        contactStore: { findById: vi.fn().mockResolvedValue(null) },
        activityStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      },
    });

    const workUnit = makeWorkUnit({
      intent: "completely-different.respond",
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "sales-pipeline",
        trustLevel: "guided",
        trustScore: 42,
      },
    });
    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(executor.lastParams?.skill.slug).toBe("sales-pipeline");
  });

  it("uses deployment context for deploymentId and trustScore", async () => {
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({ executor, skillsBySlug });

    const workUnit = makeWorkUnit({
      deployment: {
        deploymentId: "dep-real",
        skillSlug: "sales-pipeline",
        trustLevel: "autonomous",
        trustScore: 85,
      },
    });
    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(executor.lastParams?.deploymentId).toBe("dep-real");
    expect(executor.lastParams?.trustScore).toBe(85);
  });
});

describe("SkillMode context resolution (Critical 1)", () => {
  let executor: MockExecutor;
  beforeEach(() => {
    executor = new MockExecutor();
  });

  const alexLikeContext: ContextRequirement[] = [
    {
      kind: "playbook",
      scope: "objection-handling",
      injectAs: "PLAYBOOK_CONTEXT",
      required: false,
    },
    {
      kind: "business-facts",
      scope: "operator-approved",
      injectAs: "BUSINESS_FACTS",
      required: true,
    },
  ];

  it("merges resolved knowledge context into executor params and excludes business-facts", async () => {
    const contextResolver = {
      resolve: vi.fn().mockResolvedValue({
        variables: { PLAYBOOK_CONTEXT: "OBJECTION PLAYBOOK" },
        metadata: [],
      }),
    };
    const skill = makeSkill({ slug: "alex", context: alexLikeContext });
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({ executor, skillsBySlug, contextResolver });

    await mode.execute(
      makeWorkUnit({
        deployment: {
          deploymentId: "dep-1",
          skillSlug: "alex",
          trustLevel: "guided",
          trustScore: 42,
        },
      }),
      defaultConstraints,
      defaultContext,
    );

    expect(executor.lastParams?.parameters).toMatchObject({
      PLAYBOOK_CONTEXT: "OBJECTION PLAYBOOK",
    });
    expect(contextResolver.resolve).toHaveBeenCalledWith("org-1", [
      {
        kind: "playbook",
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: false,
      },
    ]);
  });

  it("fails open when context resolution throws (no 500, empty context)", async () => {
    const contextResolver = {
      resolve: vi.fn().mockRejectedValue(new Error("knowledge store down")),
    };
    const skill = makeSkill({ slug: "alex", context: alexLikeContext });
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({ executor, skillsBySlug, contextResolver });

    const result = await mode.execute(
      makeWorkUnit({
        deployment: {
          deploymentId: "dep-1",
          skillSlug: "alex",
          trustLevel: "guided",
          trustScore: 42,
        },
      }),
      defaultConstraints,
      defaultContext,
    );

    expect(result.outcome).toBe("completed");
    expect(executor.lastParams?.parameters.PLAYBOOK_CONTEXT).toBeUndefined();
  });

  it("merges context over raw workUnit.parameters (resolver wins, no builder)", async () => {
    const contextResolver = {
      resolve: vi.fn().mockResolvedValue({
        variables: { PLAYBOOK_CONTEXT: "ctx-wins" },
        metadata: [],
      }),
    };
    const skill = makeSkill({
      slug: "alex",
      context: [
        {
          kind: "playbook",
          scope: "objection-handling",
          injectAs: "PLAYBOOK_CONTEXT",
          required: false,
        },
      ],
    });
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({ executor, skillsBySlug, contextResolver });
    const workUnit = makeWorkUnit({
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "alex",
        trustLevel: "guided",
        trustScore: 42,
      },
      parameters: { PLAYBOOK_CONTEXT: "raw-should-be-overridden" },
    });

    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(executor.lastParams?.parameters.PLAYBOOK_CONTEXT).toBe("ctx-wins");
  });

  it("is a no-op when no resolver is wired even if the skill declares context", async () => {
    const skill = makeSkill({
      slug: "alex",
      context: [
        {
          kind: "playbook",
          scope: "objection-handling",
          injectAs: "PLAYBOOK_CONTEXT",
          required: false,
        },
      ],
    });
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({ executor, skillsBySlug }); // no contextResolver

    const result = await mode.execute(
      makeWorkUnit({
        deployment: {
          deploymentId: "dep-1",
          skillSlug: "alex",
          trustLevel: "guided",
          trustScore: 42,
        },
      }),
      defaultConstraints,
      defaultContext,
    );

    expect(result.outcome).toBe("completed");
    expect(executor.lastParams?.parameters.PLAYBOOK_CONTEXT).toBeUndefined();
  });
});

describe("SkillMode executorBySlug (slice-4 seam)", () => {
  it("routes a slug with a dedicated executor to it", async () => {
    const defaultExec = new MockExecutor();
    const composeExec = new MockExecutor();
    const skill = makeSkill({ slug: "creative", intent: "creative.brief.compose" });
    const mode = new SkillMode({
      executor: defaultExec,
      executorBySlug: new Map([["creative", composeExec]]),
      skillsBySlug: new Map([[skill.slug, skill]]),
    });
    const workUnit = makeWorkUnit({
      intent: "creative.brief.compose",
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "creative",
        trustLevel: "guided",
        trustScore: 42,
      },
    });

    const result = await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(result.outcome).toBe("completed");
    expect(composeExec.lastParams).toBeDefined();
    expect(defaultExec.lastParams).toBeUndefined();
  });

  it("falls back to the default executor for unmapped slugs", async () => {
    const defaultExec = new MockExecutor();
    const composeExec = new MockExecutor();
    const skill = makeSkill();
    const mode = new SkillMode({
      executor: defaultExec,
      executorBySlug: new Map([["creative", composeExec]]),
      skillsBySlug: new Map([[skill.slug, skill]]),
    });

    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("completed");
    expect(defaultExec.lastParams).toBeDefined();
    expect(composeExec.lastParams).toBeUndefined();
  });
});
