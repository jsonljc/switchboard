import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelGateway } from "@switchboard/core";
import type {
  ChannelGatewayConfig,
  DeploymentInfo,
  IncomingChannelMessage,
  ReplySink,
  SkillRuntimeDeps,
} from "@switchboard/core/channel-gateway";
import type {
  SkillDefinition,
  SkillExecutionParams,
  SkillExecutionResult,
  SkillExecutor,
} from "@switchboard/core/skill-runtime";
import type { ParameterBuilder, SkillStores } from "@switchboard/core/skill-runtime";
import type { AgentPersona } from "@switchboard/sdk";

/**
 * Ad Optimizer End-to-End Wiring Integration Test
 *
 * Verifies the full path: incoming message → ChannelGateway → SkillHandler → ad-optimizer skill → response
 */
describe("Ad Optimizer end-to-end wiring", () => {
  let mockDeploymentLookup: ChannelGatewayConfig["deploymentLookup"];
  let mockConversationStore: ChannelGatewayConfig["conversationStore"];
  let mockStateStore: ChannelGatewayConfig["stateStore"];
  let mockActionRequestStore: ChannelGatewayConfig["actionRequestStore"];
  let mockLlmAdapterFactory: ChannelGatewayConfig["llmAdapterFactory"];
  let mockSkillRuntime: SkillRuntimeDeps;
  let mockSkillExecutor: SkillExecutor;
  let mockSkillStores: SkillStores;
  let replySink: ReplySink;
  let sentMessages: string[];

  const mockPersona: AgentPersona = {
    businessName: "Test Media Co",
    tone: "professional",
  };

  const mockInputConfig = {
    monthlyBudget: "5000",
    targetCPA: "25",
    targetROAS: "3.0",
    auditFrequency: "weekly",
    pixelId: "123456",
  };

  const mockSkillDefinition: SkillDefinition = {
    name: "Ad Optimizer",
    slug: "ad-optimizer",
    version: "1.0.0",
    description: "Media strategist for campaign optimization",
    author: "Switchboard",
    parameters: [
      { name: "BUSINESS_NAME", type: "string", required: true },
      { name: "DEPLOYMENT_CONFIG", type: "object", required: true },
      { name: "PERSONA_CONFIG", type: "object", required: true },
    ],
    tools: ["ads-analytics"],
    body: "You are an ad optimization specialist.",
    context: [],
  };

  const mockSkillExecutionResult: SkillExecutionResult = {
    response: "Campaign performance looks good. Your ROAS is 3.2x this week.",
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 300,
      turnCount: 1,
      status: "success",
      responseSummary: "Campaign audit completed",
      writeCount: 0,
      governanceDecisions: [],
    },
  };

  beforeEach(() => {
    sentMessages = [];

    // Mock DeploymentLookup
    mockDeploymentLookup = {
      findByChannelToken: vi.fn(async (_channel: string, _token: string) => ({
        deployment: {
          id: "deploy_ad_opt_test",
          listingId: "listing_ad_optimizer",
          organizationId: "org_test",
          skillSlug: "ad-optimizer",
          inputConfig: mockInputConfig,
        },
        persona: mockPersona,
        trustScore: 60,
        trustLevel: "autonomous",
      })),
    };

    // Mock ConversationStore
    mockConversationStore = {
      getOrCreateBySession: vi.fn(async (_deploymentId, _channel, _sessionId) => ({
        conversationId: "conv_123",
        messages: [],
      })),
      addMessage: vi.fn(async (_conversationId, _role, _content) => {}),
    };

    // Mock StateStore
    mockStateStore = {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({})),
    };

    // Mock ActionRequestStore
    mockActionRequestStore = {
      save: vi.fn(async () => {}),
      findById: vi.fn(async () => null),
      findPendingByDeployment: vi.fn(async () => []),
      updateStatus: vi.fn(async () => {}),
    };

    // Mock LLM Adapter Factory
    mockLlmAdapterFactory = vi.fn(() => ({
      generateReply: vi.fn(async () => ({
        reply: "This is a fallback LLM response",
        usage: { inputTokens: 50, outputTokens: 30 },
      })),
    }));

    // Mock Skill Stores
    mockSkillStores = {
      opportunityStore: {
        findActiveByContact: vi.fn(async () => []),
      },
      contactStore: {
        findById: vi.fn(async () => null),
      },
      activityStore: {
        listByDeployment: vi.fn(async () => []),
      },
    };

    // Mock Skill Executor
    mockSkillExecutor = {
      execute: vi.fn(async (_params: SkillExecutionParams) => mockSkillExecutionResult),
    };

    // Mock Parameter Builder (matches real implementation)
    const mockAdOptimizerBuilder: ParameterBuilder = async (ctx, _config, _stores) => {
      const inputConfig = (ctx.deployment?.inputConfig ?? {}) as Record<string, unknown>;
      return {
        BUSINESS_NAME: ctx.persona.businessName,
        DEPLOYMENT_CONFIG: inputConfig,
        PERSONA_CONFIG: {
          tone: ctx.persona.tone,
          customInstructions: ctx.persona.customInstructions ?? "",
        },
      };
    };

    // Mock Skill Runtime
    mockSkillRuntime = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn((_slug: string, _skillsDir: string) => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map<string, ParameterBuilder>([["ad-optimizer", mockAdOptimizerBuilder]]),
      stores: mockSkillStores,
      hooks: [],
      contextResolver: {
        resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
      },
    };

    // Reply Sink
    replySink = {
      send: vi.fn(async (text: string) => {
        sentMessages.push(text);
      }),
      onTyping: vi.fn(),
    };
  });

  it("routes message through skill handler and returns skill response", async () => {
    // Arrange
    const gateway = new ChannelGateway({
      deploymentLookup: mockDeploymentLookup,
      conversationStore: mockConversationStore,
      stateStore: mockStateStore,
      actionRequestStore: mockActionRequestStore,
      llmAdapterFactory: mockLlmAdapterFactory,
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "whatsapp_token_123",
      sessionId: "session_456",
      text: "Audit my campaigns",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockDeploymentLookup.findByChannelToken).toHaveBeenCalledWith(
      "whatsapp",
      "whatsapp_token_123",
    );
    expect(mockConversationStore.getOrCreateBySession).toHaveBeenCalledWith(
      "deploy_ad_opt_test",
      "whatsapp",
      "session_456",
    );
    expect(mockConversationStore.addMessage).toHaveBeenCalledWith("conv_123", "user", message.text);
    expect(mockConversationStore.addMessage).toHaveBeenCalledWith(
      "conv_123",
      "assistant",
      mockSkillExecutionResult.response,
    );
    expect(replySink.send).toHaveBeenCalledWith(mockSkillExecutionResult.response);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toBe("Campaign performance looks good. Your ROAS is 3.2x this week.");
  });

  it("loads ad-optimizer skill when skillSlug is set", async () => {
    // Arrange
    const gateway = new ChannelGateway({
      deploymentLookup: mockDeploymentLookup,
      conversationStore: mockConversationStore,
      stateStore: mockStateStore,
      actionRequestStore: mockActionRequestStore,
      llmAdapterFactory: mockLlmAdapterFactory,
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "telegram",
      token: "telegram_token_123",
      sessionId: "session_789",
      text: "How are my ads performing?",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("ad-optimizer", "/mock/skills");
    expect(mockSkillExecutor.execute).toHaveBeenCalledTimes(1);
    const executorCallArgs = vi.mocked(mockSkillExecutor.execute).mock.calls[0]?.[0];
    expect(executorCallArgs?.skill).toEqual(mockSkillDefinition);
  });

  it("includes ads-analytics tool in skill execution", async () => {
    // Arrange
    const gateway = new ChannelGateway({
      deploymentLookup: mockDeploymentLookup,
      conversationStore: mockConversationStore,
      stateStore: mockStateStore,
      actionRequestStore: mockActionRequestStore,
      llmAdapterFactory: mockLlmAdapterFactory,
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "whatsapp_token_123",
      sessionId: "session_analytics",
      text: "Show me campaign metrics",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("ad-optimizer", "/mock/skills");
    const loadedSkill = mockSkillRuntime.loadSkill("ad-optimizer", "/mock/skills");
    expect(loadedSkill.tools).toContain("ads-analytics");
  });

  it("passes deployment config from inputConfig to skill parameters", async () => {
    // Arrange
    const gateway = new ChannelGateway({
      deploymentLookup: mockDeploymentLookup,
      conversationStore: mockConversationStore,
      stateStore: mockStateStore,
      actionRequestStore: mockActionRequestStore,
      llmAdapterFactory: mockLlmAdapterFactory,
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "whatsapp_token_123",
      sessionId: "session_params",
      text: "Audit my campaigns",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillExecutor.execute).toHaveBeenCalledTimes(1);
    const executorCallArgs = vi.mocked(mockSkillExecutor.execute).mock.calls[0]?.[0];
    expect(executorCallArgs).toBeDefined();
    expect(executorCallArgs?.parameters).toEqual({
      BUSINESS_NAME: "Test Media Co",
      DEPLOYMENT_CONFIG: mockInputConfig,
      PERSONA_CONFIG: {
        tone: "professional",
        customInstructions: "",
      },
    });
  });

  it("falls back to DefaultChatHandler when skillSlug is null", async () => {
    // Arrange
    const fullPersona: AgentPersona = {
      ...mockPersona,
      qualificationCriteria: {},
      disqualificationCriteria: {},
      escalationRules: {},
    };

    const deploymentWithoutSkill: DeploymentInfo = {
      deployment: {
        id: "deploy_no_skill",
        listingId: "listing_generic",
        organizationId: "org_test",
        skillSlug: null,
      },
      persona: fullPersona,
      trustScore: 50,
      trustLevel: "guided",
    };

    mockDeploymentLookup.findByChannelToken = vi.fn(async () => deploymentWithoutSkill);

    const gateway = new ChannelGateway({
      deploymentLookup: mockDeploymentLookup,
      conversationStore: mockConversationStore,
      stateStore: mockStateStore,
      actionRequestStore: mockActionRequestStore,
      llmAdapterFactory: mockLlmAdapterFactory,
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "telegram",
      token: "telegram_token_123",
      sessionId: "session_789",
      text: "Hello",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillRuntime.loadSkill).not.toHaveBeenCalled();
    expect(mockSkillExecutor.execute).not.toHaveBeenCalled();
    expect(mockLlmAdapterFactory).toHaveBeenCalled();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toBe("This is a fallback LLM response");
  });
});
