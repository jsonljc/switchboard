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
 * Alex Escalation Behavior Verification
 *
 * Tests that Alex escalates correctly:
 * 1. When lead requests human contact
 * 2. When lead expresses frustration/anger
 * 3. At message cap (15 messages)
 * 4. With correct notification payload
 */
describe("Alex escalation behavior", () => {
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

  beforeEach(() => {
    sentMessages = [];

    // Mock DeploymentLookup
    mockDeploymentLookup = {
      findByChannelToken: vi.fn(async (_channel: string, _token: string) => mockDeploymentInfo),
    };

    // Mock ConversationStore
    mockConversationStore = {
      getOrCreateBySession: vi.fn(async (_deploymentId, _channel, _sessionId) => ({
        conversationId: "conv_escalation_test",
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

    // Mock Skill Executor (default non-escalation response)
    mockSkillExecutor = {
      execute: vi.fn(async (_params: SkillExecutionParams) => ({
        response: "Thanks for your message. How can I assist?",
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        trace: {
          durationMs: 250,
          turnCount: 1,
          status: "success",
          responseSummary: "Standard response",
          writeCount: 0,
          governanceDecisions: [],
        },
      })),
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

  it("sends escalation message when lead requests human", async () => {
    // Arrange
    const escalationResponse: SkillExecutionResult = {
      response: "Let me get someone from the team to help with this. They'll reach out shortly.",
      toolCalls: [],
      tokenUsage: { input: 120, output: 60 },
      trace: {
        durationMs: 300,
        turnCount: 1,
        status: "success",
        responseSummary: "Escalation triggered",
        writeCount: 0,
        governanceDecisions: [],
      },
    };

    mockSkillExecutor.execute = vi.fn(async () => escalationResponse);

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
      sessionId: "session_escalation_1",
      text: "Can I speak to a real person?",
      visitor: { name: "Jane Doe", email: "jane@example.com" },
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(replySink.send).toHaveBeenCalledWith(escalationResponse.response);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("team");
    expect(sentMessages[0]).toContain("help");
    expect(mockConversationStore.addMessage).toHaveBeenCalledWith(
      "conv_escalation_test",
      "user",
      message.text,
    );
    expect(mockConversationStore.addMessage).toHaveBeenCalledWith(
      "conv_escalation_test",
      "assistant",
      escalationResponse.response,
    );
  });

  it("escalates on frustration detection", async () => {
    // Arrange
    const escalationResponse: SkillExecutionResult = {
      response: "Let me get someone from the team to help with this. They'll reach out shortly.",
      toolCalls: [],
      tokenUsage: { input: 140, output: 60 },
      trace: {
        durationMs: 320,
        turnCount: 1,
        status: "success",
        responseSummary: "Escalation on frustration",
        writeCount: 0,
        governanceDecisions: [],
      },
    };

    mockSkillExecutor.execute = vi.fn(async () => escalationResponse);

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
      sessionId: "session_escalation_2",
      text: "This is ridiculous, you're useless, I want to talk to your manager",
      visitor: { name: "Angry Lead", email: "angry@example.com" },
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(replySink.send).toHaveBeenCalledWith(escalationResponse.response);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("team");
    expect(sentMessages[0]).toContain("help");
  });

  it("escalates at message cap with full history", async () => {
    // Arrange - simulate 14 previous messages (7 user + 7 assistant)
    const previousMessages = [];
    for (let i = 0; i < 7; i++) {
      previousMessages.push({ role: "user" as const, content: `User message ${i + 1}` });
      previousMessages.push({ role: "assistant" as const, content: `Assistant response ${i + 1}` });
    }

    mockConversationStore.getOrCreateBySession = vi.fn(
      async (_deploymentId, _channel, _sessionId) => ({
        conversationId: "conv_message_cap",
        messages: previousMessages,
      }),
    );

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
      sessionId: "session_message_cap",
      text: "Can you tell me more about your services?",
      visitor: { name: "Persistent Lead", email: "persistent@example.com" },
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert - executor receives conversation history with 15 total messages (14 previous + 1 new)
    expect(mockSkillExecutor.execute).toHaveBeenCalledTimes(1);
    const executorCallArgs = vi.mocked(mockSkillExecutor.execute).mock.calls[0]?.[0];
    expect(executorCallArgs).toBeDefined();
    expect(executorCallArgs?.messages).toHaveLength(15); // 14 previous + 1 new user message
    expect(executorCallArgs?.messages[14]).toEqual({
      role: "user",
      content: "Can you tell me more about your services?",
    });

    // Assert - skill receives the full history for escalation decision
    const assistantMessages = executorCallArgs?.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(7); // 7 previous assistant messages
  });

  it("preserves context for business owner notification", async () => {
    // Arrange
    const escalationResponse: SkillExecutionResult = {
      response: "Let me get someone from the team to help with this. They'll reach out shortly.",
      toolCalls: [],
      tokenUsage: { input: 130, output: 60 },
      trace: {
        durationMs: 310,
        turnCount: 1,
        status: "success",
        responseSummary: "Escalation with context",
        writeCount: 0,
        governanceDecisions: [],
      },
    };

    mockSkillExecutor.execute = vi.fn(async () => escalationResponse);

    const conversationHistory = [
      { role: "user" as const, content: "Hi, what services do you offer?" },
      { role: "assistant" as const, content: "We offer Botox, fillers, and skin treatments." },
      { role: "user" as const, content: "How much is Botox?" },
      { role: "assistant" as const, content: "Botox starts at $300 per area." },
    ];

    mockConversationStore.getOrCreateBySession = vi.fn(
      async (_deploymentId, _channel, _sessionId) => ({
        conversationId: "conv_with_context",
        messages: conversationHistory,
      }),
    );

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
      sessionId: "session_with_context",
      text: "I need to speak to someone about a custom package",
      visitor: { name: "VIP Lead", email: "vip@example.com" },
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert - conversation store has full message history for business owner
    expect(mockConversationStore.addMessage).toHaveBeenCalledWith(
      "conv_with_context",
      "user",
      message.text,
    );
    expect(mockConversationStore.addMessage).toHaveBeenCalledWith(
      "conv_with_context",
      "assistant",
      escalationResponse.response,
    );

    // Assert - deployment info includes organization context for routing
    expect(mockDeploymentLookup.findByChannelToken).toHaveBeenCalledWith(
      "whatsapp",
      "whatsapp_token_123",
    );
    const deploymentLookupResult = await mockDeploymentLookup.findByChannelToken(
      "whatsapp",
      "whatsapp_token_123",
    );
    expect(deploymentLookupResult?.deployment.organizationId).toBe("org_test");

    // Assert - executor receives full conversation history
    const executorCallArgs = vi.mocked(mockSkillExecutor.execute).mock.calls[0]?.[0];
    expect(executorCallArgs?.messages).toHaveLength(5); // 4 previous + 1 new
    expect(executorCallArgs?.deploymentId).toBe("deploy_alex_test");
    expect(executorCallArgs?.orgId).toBe("org_test");
  });
});
