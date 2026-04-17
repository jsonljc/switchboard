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
 * Alex End-to-End Wiring Integration Test
 *
 * Verifies the full path: incoming message → ChannelGateway → SkillHandler → Alex skill → response
 */
describe("Alex end-to-end wiring", () => {
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
    businessName: "MedSpa Pro",
    tone: "warm and professional",
    qualificationCriteria: ["budget > $1000", "ready to book"],
    disqualificationCriteria: ["no budget", "just browsing"],
    escalationRules: ["high-value lead", "angry customer"],
    bookingLink: "https://medspa.com/book",
    customInstructions: "Always mention our special offers",
  };

  const mockDeploymentInfo: DeploymentInfo = {
    deployment: {
      id: "deploy_alex_test",
      listingId: "listing_alex",
      organizationId: "org_test",
      skillSlug: "alex",
    },
    persona: mockPersona,
    trustScore: 75,
    trustLevel: "autonomous",
  };

  const mockSkillDefinition: SkillDefinition = {
    name: "Alex",
    slug: "alex",
    version: "1.0.0",
    description: "CRM-aware lead qualification assistant",
    author: "Switchboard",
    parameters: [
      { name: "BUSINESS_NAME", type: "string", required: true },
      { name: "OPPORTUNITY_ID", type: "string", required: true },
      { name: "LEAD_PROFILE", type: "object", required: true },
      { name: "PERSONA_CONFIG", type: "object", required: true },
    ],
    tools: ["crm-query", "crm-write"],
    body: "You are Alex, a friendly lead qualification assistant.",
    context: [],
  };

  const mockSkillExecutionResult: SkillExecutionResult = {
    response: "Hi! What treatment are you interested in?",
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 250,
      turnCount: 1,
      status: "success",
      responseSummary: "Greeting message sent",
      writeCount: 0,
      governanceDecisions: [],
    },
  };

  beforeEach(() => {
    sentMessages = [];

    // Mock DeploymentLookup
    mockDeploymentLookup = {
      findByChannelToken: vi.fn(async (_channel: string, _token: string) => mockDeploymentInfo),
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
        findActiveByContact: vi.fn(async () => [
          { id: "opp_123", stage: "qualification", createdAt: new Date() },
        ]),
      },
      contactStore: {
        findById: vi.fn(async () => ({
          id: "contact_123",
          name: "Jane Doe",
          email: "jane@example.com",
        })),
      },
      activityStore: {
        listByDeployment: vi.fn(async () => []),
      },
    };

    // Mock Skill Executor
    mockSkillExecutor = {
      execute: vi.fn(async (_params: SkillExecutionParams) => mockSkillExecutionResult),
    };

    // Mock Parameter Builder
    const mockAlexBuilder: ParameterBuilder = vi.fn(async (ctx, _config, _stores) => ({
      BUSINESS_NAME: ctx.persona.businessName,
      OPPORTUNITY_ID: "opp_123",
      LEAD_PROFILE: { id: "contact_123", name: "Jane Doe", email: "jane@example.com" },
      PERSONA_CONFIG: {
        tone: ctx.persona.tone,
        qualificationCriteria: ctx.persona.qualificationCriteria,
        disqualificationCriteria: ctx.persona.disqualificationCriteria,
        escalationRules: ctx.persona.escalationRules,
        bookingLink: ctx.persona.bookingLink ?? "",
        customInstructions: ctx.persona.customInstructions ?? "",
      },
    }));

    // Mock Skill Runtime
    mockSkillRuntime = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn((_slug: string, _skillsDir: string) => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map<string, ParameterBuilder>([["alex", mockAlexBuilder]]),
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

  it("routes WhatsApp message through skill handler and returns skill response", async () => {
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
      text: "Hi, I want to learn about Botox",
      visitor: { name: "Jane Doe", email: "jane@example.com" },
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockDeploymentLookup.findByChannelToken).toHaveBeenCalledWith(
      "whatsapp",
      "whatsapp_token_123",
    );
    expect(mockConversationStore.getOrCreateBySession).toHaveBeenCalledWith(
      "deploy_alex_test",
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
    expect(sentMessages[0]).toBe("Hi! What treatment are you interested in?");
  });

  it("falls back to DefaultChatHandler when no skillSlug is set", async () => {
    // Arrange
    const deploymentWithoutSkill: DeploymentInfo = {
      deployment: {
        id: "deploy_no_skill",
        listingId: "listing_generic",
        organizationId: "org_test",
        skillSlug: null,
      },
      persona: mockPersona,
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

  it("persists conversation state across multiple messages", async () => {
    // Arrange
    const gateway = new ChannelGateway({
      deploymentLookup: mockDeploymentLookup,
      conversationStore: mockConversationStore,
      stateStore: mockStateStore,
      actionRequestStore: mockActionRequestStore,
      llmAdapterFactory: mockLlmAdapterFactory,
      skillRuntime: mockSkillRuntime,
    });

    const message1: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "whatsapp_token_123",
      sessionId: "session_persistence",
      text: "Hi there",
    };

    const message2: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "whatsapp_token_123",
      sessionId: "session_persistence",
      text: "I want to book Botox",
    };

    // Mock conversation store to return history on second call
    mockConversationStore.getOrCreateBySession = vi
      .fn()
      .mockResolvedValueOnce({
        conversationId: "conv_persist_123",
        messages: [],
      })
      .mockResolvedValueOnce({
        conversationId: "conv_persist_123",
        messages: [
          { role: "user", content: "Hi there" },
          { role: "assistant", content: "Hi! What treatment are you interested in?" },
        ],
      });

    // Act - First message
    await gateway.handleIncoming(message1, replySink);

    // Act - Second message
    await gateway.handleIncoming(message2, replySink);

    // Assert
    expect(mockConversationStore.getOrCreateBySession).toHaveBeenCalledTimes(2);
    expect(mockConversationStore.getOrCreateBySession).toHaveBeenNthCalledWith(
      1,
      "deploy_alex_test",
      "whatsapp",
      "session_persistence",
    );
    expect(mockConversationStore.getOrCreateBySession).toHaveBeenNthCalledWith(
      2,
      "deploy_alex_test",
      "whatsapp",
      "session_persistence",
    );
    expect(mockConversationStore.addMessage).toHaveBeenCalledTimes(4); // 2 user + 2 assistant
  });

  it("passes correct parameters to skill executor", async () => {
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
      sessionId: "session_params_check",
      text: "What services do you offer?",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillExecutor.execute).toHaveBeenCalledTimes(1);
    const executorCallArgs = vi.mocked(mockSkillExecutor.execute).mock.calls[0]?.[0];
    expect(executorCallArgs).toBeDefined();
    expect(executorCallArgs?.skill).toEqual(mockSkillDefinition);
    expect(executorCallArgs?.parameters).toEqual({
      BUSINESS_NAME: "MedSpa Pro",
      OPPORTUNITY_ID: "opp_123",
      LEAD_PROFILE: { id: "contact_123", name: "Jane Doe", email: "jane@example.com" },
      PERSONA_CONFIG: {
        tone: "warm and professional",
        qualificationCriteria: ["budget > $1000", "ready to book"],
        disqualificationCriteria: ["no budget", "just browsing"],
        escalationRules: ["high-value lead", "angry customer"],
        bookingLink: "https://medspa.com/book",
        customInstructions: "Always mention our special offers",
      },
    });
    expect(executorCallArgs?.deploymentId).toBe("deploy_alex_test");
    expect(executorCallArgs?.orgId).toBe("org_test");
    expect(executorCallArgs?.trustScore).toBe(75);
    expect(executorCallArgs?.trustLevel).toBe("autonomous");
    expect(executorCallArgs?.messages).toEqual([
      { role: "user", content: "What services do you offer?" },
    ]);
  });

  it("invokes typing indicator when available", async () => {
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
      sessionId: "session_typing",
      text: "Hello",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(replySink.onTyping).toHaveBeenCalled();
  });
});
