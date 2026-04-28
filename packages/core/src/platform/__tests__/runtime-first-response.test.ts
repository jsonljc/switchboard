// packages/core/src/platform/__tests__/runtime-first-response.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { ChannelGateway } from "../../channel-gateway/channel-gateway.js";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import { SkillMode } from "../modes/skill-mode.js";
import { BuilderRegistry } from "../../skill-runtime/builder-registry.js";
import { SkillExecutorImpl } from "../../skill-runtime/skill-executor.js";
import { AnthropicToolCallingAdapter } from "../../skill-runtime/tool-calling-adapter.js";
import { loadSkill } from "../../skill-runtime/skill-loader.js";
import { createEscalateToolFactory } from "../../skill-runtime/tools/escalate.js";
import { ok } from "../../skill-runtime/tool-result.js";
import { VERTICALS } from "../../skill-runtime/__tests__/behavior-fixtures/verticals.js";
import { toDeploymentContext } from "../deployment-resolver.js";
import type { DeploymentResolverResult, DeploymentResolver } from "../deployment-resolver.js";
import type { GovernanceGateInterface } from "../platform-ingress.js";
import type {
  GatewayConversationStore,
  IncomingChannelMessage,
  ReplySink,
} from "../../channel-gateway/types.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type { WorkTrace } from "../work-trace.js";
import type { SkillTool } from "../../skill-runtime/types.js";
import type { SkillStores } from "../../skill-runtime/parameter-builder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../..");

const DENTAL = VERTICALS.find((v) => v.id === "dental-aesthetic")!;

const DEPLOYMENT: DeploymentResolverResult = {
  deploymentId: "dep-alex-dental",
  listingId: "list-alex",
  organizationId: "org-smilecraft",
  skillSlug: "alex",
  trustScore: 50,
  trustLevel: "guided",
  persona: {
    businessName: DENTAL.businessName,
    tone: DENTAL.personaConfig.tone,
    qualificationCriteria: Object.values(DENTAL.personaConfig.qualificationCriteria),
    disqualificationCriteria: Object.values(DENTAL.personaConfig.disqualificationCriteria),
    escalationRules: Object.keys(DENTAL.personaConfig.escalationRules).filter(
      (k) => DENTAL.personaConfig.escalationRules[k],
    ),
    bookingLink: DENTAL.personaConfig.bookingLink,
    customInstructions: DENTAL.personaConfig.customInstructions,
  },
  deploymentConfig: {},
  policyOverrides: undefined,
};

// Universal forbidden patterns for all responses
const UNIVERSAL_FORBIDDEN = [
  /crm-write/i,
  /crm-query/i,
  /escalate tool/i,
  /calendar-book/i,
  /great question/i,
  /i understand your concern/i,
  /thank you for reaching out/i,
];

// Hedge words (for unknown-fact scenarios only)
const HEDGE_WORDS = [/\bprobably\b/i, /\bi think\b/i, /\busually\b/i, /\btypically\b/i];

// Safe fallback pattern (when escalate not called for unknown facts)
const SAFE_FALLBACK =
  /not (certain|sure)|team member|confirm for you|check on that|get.{0,10}(someone|team).{0,10}(help|confirm|check)/i;

function createMockTools(): Map<string, SkillTool> {
  const tools = new Map<string, SkillTool>();
  tools.set("crm-query", {
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get contact",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "read" as const,
        execute: async () => ok({ id: "c1", name: "Test Lead", stage: "new" }),
      },
      "activity.list": {
        description: "List activities",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "read" as const,
        execute: async () => ok({ activities: [] }),
      },
    },
  });
  tools.set("crm-write", {
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "Update stage",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "write" as const,
        execute: async (params: unknown) => ok({ ...(params as object), updated: true }),
      },
      "activity.log": {
        description: "Log activity",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "write" as const,
        execute: async () => ok(),
      },
    },
  });
  tools.set(
    "escalate",
    createEscalateToolFactory({
      assembler: {
        assemble: () => ({
          id: "h_1",
          sessionId: "s",
          organizationId: "o",
          reason: "missing_knowledge" as const,
          status: "pending" as const,
          leadSnapshot: { channel: "whatsapp" },
          qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
          conversationSummary: {
            turnCount: 0,
            keyTopics: [],
            objectionHistory: [],
            sentiment: "neutral",
          },
          slaDeadlineAt: new Date(),
          createdAt: new Date(),
        }),
      },
      handoffStore: { save: async () => {}, getBySessionId: async () => null },
      notifier: { notify: async () => {} },
    })({
      sessionId: "test-session",
      orgId: "test-org",
      deploymentId: "test-deployment",
    }),
  );
  tools.set("calendar-book", {
    id: "calendar-book",
    operations: {
      "slots.query": {
        description: "Query available booking slots",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "read" as const,
        execute: async () => ok({ slots: [] }),
      },
      "booking.create": {
        description: "Create a booking",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "write" as const,
        execute: async () => ok({ bookingId: "b1", confirmed: true }),
      },
    },
  });
  return tools;
}

function countSentences(text: string): number {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return sentences.length;
}

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Runtime First Response", () => {
  let gateway: ChannelGateway;
  let governanceSpy: ReturnType<typeof vi.fn>;
  let replySink: ReplySink & { sent: string[] };
  let toolInvocations: Array<{ toolId: string; operation?: string }>;

  beforeEach(() => {
    // Load Alex skill
    const skill = loadSkill("alex", join(REPO_ROOT, "skills"));

    // Real LLM adapter
    const adapter = new AnthropicToolCallingAdapter(
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    );

    // Track tool invocations
    toolInvocations = [];
    const mockTools = createMockTools();
    const wrappedTools = new Map<string, SkillTool>();
    for (const [id, tool] of mockTools.entries()) {
      const wrappedOps: SkillTool["operations"] = {};
      for (const [opName, op] of Object.entries(tool.operations)) {
        wrappedOps[opName] = {
          ...op,
          execute: async (params: unknown) => {
            toolInvocations.push({ toolId: id, operation: opName });
            return op.execute(params);
          },
        };
      }
      wrappedTools.set(id, { id, operations: wrappedOps });
    }

    // Real SkillExecutor
    const executor = new SkillExecutorImpl(adapter, wrappedTools);

    // BuilderRegistry for alex
    const builderRegistry = new BuilderRegistry();
    builderRegistry.register("alex", async (_ctx) => ({
      BUSINESS_NAME: DENTAL.businessName,
      OPPORTUNITY_ID: "opp-test-1",
      LEAD_PROFILE: { name: "Sarah", phone: "+6591234567" },
      BUSINESS_FACTS: DENTAL.businessFacts,
      PERSONA_CONFIG: DENTAL.personaConfig,
      message: _ctx.workUnit.parameters.message,
      conversation: _ctx.workUnit.parameters.conversation,
    }));

    // Mock stores for SkillMode
    const stores: SkillStores = {
      opportunityStore: { findActiveByContact: vi.fn().mockResolvedValue([]) },
      contactStore: { findById: vi.fn().mockResolvedValue(null) },
      activityStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
    };

    // SkillMode with real executor
    const skillsBySlug = new Map([[skill.slug, skill]]);
    const skillMode = new SkillMode({
      executor,
      skillsBySlug,
      builderRegistry,
      stores,
    });

    // IntentRegistry
    const intentRegistry = new IntentRegistry();
    intentRegistry.register({
      intent: "alex.respond",
      defaultMode: "skill",
      allowedModes: ["skill"],
      executor: { mode: "skill", skillSlug: "alex" },
      parameterSchema: {},
      mutationClass: "read",
      budgetClass: "cheap",
      approvalPolicy: "none",
      idempotent: false,
      allowedTriggers: ["chat", "api"],
      timeoutMs: 60000,
      retryable: false,
    });

    // ExecutionModeRegistry
    const modeRegistry = new ExecutionModeRegistry();
    modeRegistry.register(skillMode);

    // GovernanceGate spy
    governanceSpy = vi.fn().mockResolvedValue({
      outcome: "execute",
      riskScore: 0.1,
      budgetProfile: "standard",
      constraints: {
        allowedModelTiers: ["default"],
        maxToolCalls: 10,
        maxLlmTurns: 5,
        maxTotalTokens: 50000,
        maxRuntimeMs: 60000,
        maxWritesPerExecution: 5,
        trustLevel: "guided",
      },
      matchedPolicies: [],
    });
    const governanceGate: GovernanceGateInterface = {
      evaluate: governanceSpy,
    };

    // TraceStore
    const traceStore: WorkTraceStore = {
      persist: vi.fn(async (_trace: WorkTrace) => {}),
      getByWorkUnitId: vi.fn(async (_id: string) => null),
      update: vi.fn(async (_id: string, _fields: Partial<WorkTrace>) => ({
        ok: true as const,
        trace: {} as never,
      })),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };

    // DeploymentResolver (mock)
    const deploymentResolver: DeploymentResolver = {
      resolveByChannelToken: vi.fn(async (_channel: string, _token: string) => DEPLOYMENT),
      resolveByDeploymentId: vi.fn(async (_id: string) => DEPLOYMENT),
      resolveByOrgAndSlug: vi.fn(async (_org: string, _slug: string) => DEPLOYMENT),
    };

    // PlatformIngress
    const ingress = new PlatformIngress({
      intentRegistry,
      modeRegistry,
      governanceGate,
      deploymentResolver: {
        resolve: vi.fn(async () => toDeploymentContext(DEPLOYMENT)),
      },
      traceStore,
    });

    // ConversationStore (in-memory)
    const conversationStore: GatewayConversationStore = {
      getOrCreateBySession: vi.fn(async (_depId, _channel, _sessionId) => ({
        conversationId: "conv-1",
        messages: [],
      })),
      addMessage: vi.fn(async (_convId, _role, _content) => {}),
    };

    // ReplySink
    replySink = {
      sent: [] as string[],
      send: async (text: string) => {
        replySink.sent.push(text);
      },
      onTyping: () => {},
    };

    // ChannelGateway
    gateway = new ChannelGateway({
      deploymentResolver,
      platformIngress: ingress,
      conversationStore,
    });
  });

  it("known fact: teeth whitening price → contains 388, 1-4 sentences, no forbidden patterns", async () => {
    const message: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "test-token",
      sessionId: "sess-1",
      text: "Hi, how much for teeth whitening?",
    };

    await gateway.handleIncoming(message, replySink);

    // Assert: replySink.send called once
    expect(replySink.sent).toHaveLength(1);
    const response = replySink.sent[0]!;
    console.warn(`[Known fact] Response:\n${response}\n`);

    // Assert: contains 388
    expect(response, "Expected response to contain 388").toMatch(/388/);

    // Assert: 1-4 sentences
    const sentenceCount = countSentences(response);
    expect(sentenceCount, `Expected 1-4 sentences, got ${sentenceCount}`).toBeGreaterThanOrEqual(1);
    expect(sentenceCount, `Expected 1-4 sentences, got ${sentenceCount}`).toBeLessThanOrEqual(4);

    // Assert: no forbidden patterns
    for (const pattern of UNIVERSAL_FORBIDDEN) {
      expect(response, `Forbidden pattern: ${pattern}`).not.toMatch(pattern);
    }

    // Assert: governance spy called with correct intent
    expect(governanceSpy).toHaveBeenCalledOnce();
    const workUnit = governanceSpy.mock.calls[0]![0];
    expect(workUnit.intent).toBe("alex.respond");
    expect(workUnit.deployment?.skillSlug).toBe("alex");
  }, 60_000);

  it("unknown fact: MediSave → no false claims, no hedges, escalation or safe fallback", async () => {
    const message: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "test-token",
      sessionId: "sess-2",
      text: "Do you accept MediSave for teeth whitening?",
    };

    await gateway.handleIncoming(message, replySink);

    // Assert: replySink.send called once
    expect(replySink.sent).toHaveLength(1);
    const response = replySink.sent[0]!;
    console.warn(`[Unknown fact] Response:\n${response}\n`);

    // Assert: no forbidden claims about MediSave
    const forbiddenClaims = DENTAL.unknownFactScenario.forbiddenClaims;
    for (const pattern of forbiddenClaims) {
      expect(response, `Forbidden claim: ${pattern}`).not.toMatch(pattern);
    }

    // Assert: no hedge words
    for (const pattern of HEDGE_WORDS) {
      expect(response, `Hedge word: ${pattern}`).not.toMatch(pattern);
    }

    // Assert: no universal forbidden patterns
    for (const pattern of UNIVERSAL_FORBIDDEN) {
      expect(response, `Forbidden pattern: ${pattern}`).not.toMatch(pattern);
    }

    // Assert: either escalate tool invoked OR safe fallback phrase
    const escalated = toolInvocations.some((t) => t.toolId === "escalate");
    const usedSafeFallback = SAFE_FALLBACK.test(response);
    expect(escalated || usedSafeFallback, "Expected escalation or safe fallback phrase").toBe(true);

    // Assert: 1-4 sentences
    const sentenceCount = countSentences(response);
    expect(sentenceCount, `Expected 1-4 sentences, got ${sentenceCount}`).toBeGreaterThanOrEqual(1);
    expect(sentenceCount, `Expected 1-4 sentences, got ${sentenceCount}`).toBeLessThanOrEqual(4);

    // Assert: governance spy called
    expect(governanceSpy).toHaveBeenCalledOnce();
  }, 60_000);
});
