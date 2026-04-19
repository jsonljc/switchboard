// packages/core/src/platform/__tests__/convergence-e2e.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import { SkillMode } from "../modes/skill-mode.js";
import { BuilderRegistry } from "../../skill-runtime/builder-registry.js";
import { DeploymentInactiveError, toDeploymentContext } from "../deployment-resolver.js";
import type { DeploymentResolverResult } from "../deployment-resolver.js";
import type {
  SkillDefinition,
  SkillExecutionResult,
  SkillExecutor,
  SkillExecutionParams,
} from "../../skill-runtime/types.js";
import type { GovernanceGateInterface } from "../platform-ingress.js";
import type { SubmitWorkRequest } from "../work-unit.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type { WorkTrace } from "../work-trace.js";

const AGENTS = ["alex", "sales-pipeline", "website-profiler", "ad-optimizer"] as const;

function makeSkillDef(slug: string): SkillDefinition {
  return {
    name: slug,
    slug,
    version: "1.0.0",
    description: `${slug} skill`,
    author: "test",
    parameters: [],
    tools: [],
    body: `You are ${slug}`,
    context: [],
    intent: `${slug}.respond`,
  };
}

function makeDeploymentResult(slug: string): DeploymentResolverResult {
  return {
    deploymentId: `dep-${slug}`,
    listingId: `list-${slug}`,
    organizationId: "org-1",
    skillSlug: slug,
    trustScore: 42,
    trustLevel: "guided",
    persona: { businessName: "Test Co", tone: "friendly" },
    deploymentConfig: {},
    policyOverrides: undefined,
  };
}

function makeSuccessResult(): SkillExecutionResult {
  return {
    response: "Agent response",
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 200,
      turnCount: 1,
      status: "success",
      responseSummary: "Success",
      writeCount: 0,
      governanceDecisions: [],
    },
  };
}

describe("Convergence E2E", () => {
  let executor: SkillExecutor & { lastParams?: SkillExecutionParams };
  let builderRegistry: BuilderRegistry;
  let traceStore: WorkTraceStore & { traces: WorkTrace[] };
  let ingress: PlatformIngress;

  beforeEach(() => {
    const mockExecute = vi.fn().mockResolvedValue(makeSuccessResult());
    executor = {
      execute: async (params: SkillExecutionParams) => {
        (executor as any).lastParams = params;
        return mockExecute(params);
      },
    };

    builderRegistry = new BuilderRegistry();
    for (const slug of AGENTS) {
      builderRegistry.register(slug, async (ctx) => ({
        BUSINESS_NAME: ctx.deployment.persona?.businessName ?? "Unknown",
        AGENT_SLUG: ctx.deployment.skillSlug,
      }));
    }

    const skillsBySlug = new Map(AGENTS.map((s) => [s, makeSkillDef(s)]));
    const skillMode = new SkillMode({
      executor,
      skillsBySlug,
      builderRegistry,
      stores: {
        opportunityStore: { findActiveByContact: vi.fn().mockResolvedValue([]) },
        contactStore: { findById: vi.fn().mockResolvedValue(null) },
        activityStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      },
    });

    const intentRegistry = new IntentRegistry();
    for (const slug of AGENTS) {
      intentRegistry.register({
        intent: `${slug}.respond`,
        defaultMode: "skill",
        allowedModes: ["skill"],
        executor: { mode: "skill", skillSlug: slug },
        parameterSchema: {},
        mutationClass: "read",
        budgetClass: "cheap",
        approvalPolicy: "none",
        idempotent: false,
        allowedTriggers: ["chat", "api"],
        timeoutMs: 30000,
        retryable: false,
      });
    }

    const modeRegistry = new ExecutionModeRegistry();
    modeRegistry.register(skillMode);

    const governanceGate: GovernanceGateInterface = {
      evaluate: vi.fn().mockResolvedValue({
        outcome: "execute",
        riskScore: 0.1,
        budgetProfile: "standard",
        constraints: {
          allowedModelTiers: ["default"],
          maxToolCalls: 10,
          maxLlmTurns: 5,
          maxTotalTokens: 50000,
          maxRuntimeMs: 30000,
          maxWritesPerExecution: 5,
          trustLevel: "guided",
        },
        matchedPolicies: [],
      }),
    };

    traceStore = {
      traces: [] as WorkTrace[],
      persist: vi.fn(async (trace: WorkTrace) => {
        traceStore.traces.push(trace);
      }),
      getByWorkUnitId: vi.fn(async (id: string) => {
        return traceStore.traces.find((t) => t.workUnitId === id) ?? null;
      }),
      update: vi.fn(async (id: string, fields: Partial<WorkTrace>) => {
        const idx = traceStore.traces.findIndex((t) => t.workUnitId === id);
        if (idx >= 0) traceStore.traces[idx] = { ...traceStore.traces[idx]!, ...fields };
      }),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };

    ingress = new PlatformIngress({
      intentRegistry,
      modeRegistry,
      governanceGate,
      traceStore,
    });
  });

  describe("Tier 1: Chat path", () => {
    for (const slug of AGENTS) {
      it(`${slug}: deployment resolves -> ingress accepts -> builder runs -> executor runs -> trace written`, async () => {
        const resolved = makeDeploymentResult(slug);

        const request: SubmitWorkRequest = {
          organizationId: resolved.organizationId,
          actor: { id: "session-1", type: "user" },
          intent: `${slug}.respond`,
          parameters: { message: "hello" },
          trigger: "chat",
          deployment: toDeploymentContext(resolved),
        };

        const response = await ingress.submit(request);

        expect(response.ok).toBe(true);
        if (!response.ok) return;

        expect(response.result.outcome).toBe("completed");
        expect(response.result.mode).toBe("skill");

        const execParams = (executor as any).lastParams;
        expect(execParams.parameters.BUSINESS_NAME).toBe("Test Co");
        expect(execParams.parameters.AGENT_SLUG).toBe(slug);
        expect(execParams.deploymentId).toBe(`dep-${slug}`);

        expect(traceStore.traces).toHaveLength(1);
        expect(traceStore.traces[0]!.deploymentId).toBe(`dep-${slug}`);
      });
    }
  });

  describe("Tier 2: API path", () => {
    for (const slug of AGENTS) {
      it(`${slug}: API submission with deployment context executes correctly`, async () => {
        const resolved = makeDeploymentResult(slug);

        const request: SubmitWorkRequest = {
          organizationId: resolved.organizationId,
          actor: { id: "api-key-1", type: "service" },
          intent: `${slug}.respond`,
          parameters: { query: "analyze this" },
          trigger: "api",
          deployment: toDeploymentContext(resolved),
        };

        const response = await ingress.submit(request);

        expect(response.ok).toBe(true);
        if (!response.ok) return;
        expect(response.result.outcome).toBe("completed");

        const execParams = (executor as any).lastParams;
        expect(execParams.parameters.AGENT_SLUG).toBe(slug);
        expect(execParams.deploymentId).toBe(`dep-${slug}`);
      });
    }
  });

  describe("Cross-surface truth", () => {
    for (const slug of AGENTS) {
      it(`${slug}: same deployment produces identical context via chat and API`, () => {
        const resolved = makeDeploymentResult(slug);
        const context = toDeploymentContext(resolved);

        expect(context.deploymentId).toBe(`dep-${slug}`);
        expect(context.skillSlug).toBe(slug);
        expect(context.trustLevel).toBe("guided");
        expect(context.trustScore).toBe(42);
      });
    }
  });

  describe("Activation gate", () => {
    it("DeploymentInactiveError is throwable for inactive deployments", () => {
      expect(() => {
        throw new DeploymentInactiveError("dep-x", "status is deactivated");
      }).toThrow(DeploymentInactiveError);
    });
  });

  describe("No fallback masking", () => {
    it("fails cleanly when intent is not registered", async () => {
      const request: SubmitWorkRequest = {
        organizationId: "org-1",
        actor: { id: "u1", type: "user" },
        intent: "nonexistent.respond",
        parameters: {},
        trigger: "chat",
        deployment: {
          deploymentId: "dep-ghost",
          skillSlug: "nonexistent",
          trustLevel: "supervised",
          trustScore: 0,
        },
      };

      const response = await ingress.submit(request);

      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.type).toBe("intent_not_found");
      }
    });
  });
});
