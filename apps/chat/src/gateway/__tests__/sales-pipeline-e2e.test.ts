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
 * Sales Pipeline End-to-End Wiring Integration Test
 *
 * Verifies the full path: incoming message → ChannelGateway → SkillHandler → sales-pipeline skill → response
 * Tests all 3 role variants: speed-to-lead (leads), sales-closer (growth), nurture-specialist (care)
 */
describe("Sales Pipeline end-to-end wiring", () => {
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
    businessName: "Austin Bakery Co",
    tone: "friendly",
    bookingLink: "https://cal.com/austin-bakery",
  };

  const mockSkillDefinition: SkillDefinition = {
    name: "Sales Pipeline",
    slug: "sales-pipeline",
    version: "1.0.0",
    description: "Multi-role sales pipeline agent",
    author: "Switchboard",
    parameters: [
      { name: "BUSINESS_NAME", type: "string", required: true },
      { name: "TONE", type: "string", required: true },
      { name: "BOOKING_LINK", type: "string", required: true },
      { name: "ROLE_FOCUS", type: "string", required: true },
    ],
    tools: [],
    body: "You are a sales pipeline assistant.",
    context: [],
  };

  const mockSkillExecutionResult: SkillExecutionResult = {
    response: "Thank you for your interest! Let me help you with that.",
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 250,
      turnCount: 1,
      status: "success",
      responseSummary: "Response sent",
      writeCount: 0,
      governanceDecisions: [],
    },
  };

  beforeEach(() => {
    sentMessages = [];

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
          name: "John Doe",
          email: "john@example.com",
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

    // Reply Sink
    replySink = {
      send: vi.fn(async (text: string) => {
        sentMessages.push(text);
      }),
      onTyping: vi.fn(),
    };
  });

  it("routes speed-to-lead deployment (roleFocus: leads) through skill handler", async () => {
    // Arrange
    const speedToLeadDeployment: DeploymentInfo = {
      deployment: {
        id: "deploy_speed_to_lead",
        listingId: "listing_speed_to_lead",
        organizationId: "org_test",
        skillSlug: "sales-pipeline",
      },
      persona: mockPersona,
      trustScore: 50,
      trustLevel: "guided",
    };

    mockDeploymentLookup = {
      findByChannelToken: vi.fn(async (_channel: string, _token: string) => speedToLeadDeployment),
    };

    const mockBuilder: ParameterBuilder = vi.fn(async (ctx, config, stores) => {
      // Mock finding an opportunity
      const opportunities = await stores.opportunityStore.findActiveByContact(
        config.orgId,
        config.contactId,
      );
      const opportunity = opportunities[0] ?? { id: "opp_123", stage: "qualification" };
      const leadProfile = await stores.contactStore.findById(config.orgId, config.contactId);

      return {
        BUSINESS_NAME: ctx.persona.businessName,
        PIPELINE_STAGE: opportunity.stage,
        OPPORTUNITY_ID: opportunity.id,
        LEAD_PROFILE: leadProfile,
        PERSONA_CONFIG: {
          tone: ctx.persona.tone,
          qualificationCriteria: ctx.persona.qualificationCriteria,
          disqualificationCriteria: ctx.persona.disqualificationCriteria,
          escalationRules: ctx.persona.escalationRules,
          bookingLink: ctx.persona.bookingLink ?? "",
          customInstructions: ctx.persona.customInstructions ?? "",
        },
      };
    });

    mockSkillRuntime = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn((_slug: string, _skillsDir: string) => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map<string, ParameterBuilder>([["sales-pipeline", mockBuilder]]),
      stores: mockSkillStores,
      hooks: [],
      contextResolver: {
        resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
      },
    };

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
      text: "I'm interested in your bakery services",
      visitor: { name: "John Doe", email: "john@example.com" },
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("sales-pipeline", "/mock/skills");
    expect(mockSkillRuntime.createExecutor).toHaveBeenCalled();
    expect(mockSkillExecutor.execute).toHaveBeenCalled();
    expect(replySink.send).toHaveBeenCalledWith(mockSkillExecutionResult.response);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toBe("Thank you for your interest! Let me help you with that.");
  });

  it("routes sales-closer deployment (roleFocus: growth) through skill handler", async () => {
    // Arrange
    const salesCloserDeployment: DeploymentInfo = {
      deployment: {
        id: "deploy_sales_closer",
        listingId: "listing_sales_closer",
        organizationId: "org_test",
        skillSlug: "sales-pipeline",
      },
      persona: mockPersona,
      trustScore: 60,
      trustLevel: "autonomous",
    };

    mockDeploymentLookup = {
      findByChannelToken: vi.fn(async (_channel: string, _token: string) => salesCloserDeployment),
    };

    const mockBuilder: ParameterBuilder = vi.fn(async (ctx, config, stores) => {
      const opportunities = await stores.opportunityStore.findActiveByContact(
        config.orgId,
        config.contactId,
      );
      const opportunity = opportunities[0] ?? { id: "opp_456", stage: "closing" };
      const leadProfile = await stores.contactStore.findById(config.orgId, config.contactId);

      return {
        BUSINESS_NAME: ctx.persona.businessName,
        PIPELINE_STAGE: opportunity.stage,
        OPPORTUNITY_ID: opportunity.id,
        LEAD_PROFILE: leadProfile,
        PERSONA_CONFIG: {
          tone: ctx.persona.tone,
          qualificationCriteria: ctx.persona.qualificationCriteria,
          disqualificationCriteria: ctx.persona.disqualificationCriteria,
          escalationRules: ctx.persona.escalationRules,
          bookingLink: ctx.persona.bookingLink ?? "",
          customInstructions: ctx.persona.customInstructions ?? "",
        },
      };
    });

    mockSkillRuntime = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn((_slug: string, _skillsDir: string) => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map<string, ParameterBuilder>([["sales-pipeline", mockBuilder]]),
      stores: mockSkillStores,
      hooks: [],
      contextResolver: {
        resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
      },
    };

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
      text: "Ready to place an order",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("sales-pipeline", "/mock/skills");
    expect(mockSkillRuntime.createExecutor).toHaveBeenCalled();
    expect(mockSkillExecutor.execute).toHaveBeenCalled();
    expect(replySink.send).toHaveBeenCalledWith(mockSkillExecutionResult.response);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toBe("Thank you for your interest! Let me help you with that.");
  });

  it("routes nurture-specialist deployment (roleFocus: care) through skill handler", async () => {
    // Arrange
    const nurtureSpecialistDeployment: DeploymentInfo = {
      deployment: {
        id: "deploy_nurture_specialist",
        listingId: "listing_nurture_specialist",
        organizationId: "org_test",
        skillSlug: "sales-pipeline",
      },
      persona: mockPersona,
      trustScore: 45,
      trustLevel: "guided",
    };

    mockDeploymentLookup = {
      findByChannelToken: vi.fn(
        async (_channel: string, _token: string) => nurtureSpecialistDeployment,
      ),
    };

    const mockBuilder: ParameterBuilder = vi.fn(async (ctx, config, stores) => {
      const opportunities = await stores.opportunityStore.findActiveByContact(
        config.orgId,
        config.contactId,
      );
      const opportunity = opportunities[0] ?? { id: "opp_789", stage: "nurture" };
      const leadProfile = await stores.contactStore.findById(config.orgId, config.contactId);

      return {
        BUSINESS_NAME: ctx.persona.businessName,
        PIPELINE_STAGE: opportunity.stage,
        OPPORTUNITY_ID: opportunity.id,
        LEAD_PROFILE: leadProfile,
        PERSONA_CONFIG: {
          tone: ctx.persona.tone,
          qualificationCriteria: ctx.persona.qualificationCriteria,
          disqualificationCriteria: ctx.persona.disqualificationCriteria,
          escalationRules: ctx.persona.escalationRules,
          bookingLink: ctx.persona.bookingLink ?? "",
          customInstructions: ctx.persona.customInstructions ?? "",
        },
      };
    });

    mockSkillRuntime = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn((_slug: string, _skillsDir: string) => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map<string, ParameterBuilder>([["sales-pipeline", mockBuilder]]),
      stores: mockSkillStores,
      hooks: [],
      contextResolver: {
        resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
      },
    };

    const gateway = new ChannelGateway({
      deploymentLookup: mockDeploymentLookup,
      conversationStore: mockConversationStore,
      stateStore: mockStateStore,
      actionRequestStore: mockActionRequestStore,
      llmAdapterFactory: mockLlmAdapterFactory,
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "slack",
      token: "slack_token_123",
      sessionId: "session_abc",
      text: "Following up on our previous conversation",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("sales-pipeline", "/mock/skills");
    expect(mockSkillRuntime.createExecutor).toHaveBeenCalled();
    expect(mockSkillExecutor.execute).toHaveBeenCalled();
    expect(replySink.send).toHaveBeenCalledWith(mockSkillExecutionResult.response);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toBe("Thank you for your interest! Let me help you with that.");
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
      persona: {
        businessName: "Austin Bakery Co",
        tone: "friendly",
        bookingLink: "https://cal.com/austin-bakery",
        qualificationCriteria: ["interested in bakery products"],
        disqualificationCriteria: ["not in service area"],
        escalationRules: ["complex requests"],
      },
      trustScore: 50,
      trustLevel: "guided",
    };

    mockDeploymentLookup = {
      findByChannelToken: vi.fn(async () => deploymentWithoutSkill),
    };

    const mockBuilder: ParameterBuilder = vi.fn(async (ctx, config, stores) => {
      const opportunities = await stores.opportunityStore.findActiveByContact(
        config.orgId,
        config.contactId,
      );
      const opportunity = opportunities[0] ?? { id: "opp_fallback", stage: "qualification" };
      const leadProfile = await stores.contactStore.findById(config.orgId, config.contactId);

      return {
        BUSINESS_NAME: ctx.persona.businessName,
        PIPELINE_STAGE: opportunity.stage,
        OPPORTUNITY_ID: opportunity.id,
        LEAD_PROFILE: leadProfile,
        PERSONA_CONFIG: {
          tone: ctx.persona.tone,
          qualificationCriteria: ctx.persona.qualificationCriteria,
          disqualificationCriteria: ctx.persona.disqualificationCriteria,
          escalationRules: ctx.persona.escalationRules,
          bookingLink: ctx.persona.bookingLink ?? "",
          customInstructions: ctx.persona.customInstructions ?? "",
        },
      };
    });

    mockSkillRuntime = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn((_slug: string, _skillsDir: string) => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map<string, ParameterBuilder>([["sales-pipeline", mockBuilder]]),
      stores: mockSkillStores,
      hooks: [],
      contextResolver: {
        resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
      },
    };

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
      sessionId: "session_fallback",
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
