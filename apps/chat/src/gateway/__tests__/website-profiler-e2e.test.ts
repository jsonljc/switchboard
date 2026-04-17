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
 * Website Profiler End-to-End Wiring Integration Test
 *
 * Verifies the full path: incoming message → ChannelGateway → SkillHandler → Website Profiler skill → response
 */
describe("Website Profiler end-to-end wiring", () => {
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
    businessName: "Website Profiler",
    tone: "professional",
    qualificationCriteria: [],
    disqualificationCriteria: [],
    escalationRules: [],
  };

  const mockDeploymentInfo: DeploymentInfo = {
    deployment: {
      id: "deploy_profiler_test",
      listingId: "listing_profiler",
      organizationId: "org_test",
      skillSlug: "website-profiler",
    },
    persona: mockPersona,
    trustScore: 50,
    trustLevel: "guided",
  };

  const mockSkillDefinition: SkillDefinition = {
    name: "Website Profiler",
    slug: "website-profiler",
    version: "1.0.0",
    description: "Website analysis agent",
    author: "Switchboard",
    parameters: [
      { name: "TARGET_URL", type: "string", required: true },
      { name: "BUSINESS_NAME", type: "string", required: false },
      { name: "PERSONA_CONFIG", type: "object", required: false },
    ],
    tools: ["web-scanner"],
    body: "You are a website profiler.",
    context: [],
  };

  const mockSkillExecutionResult: SkillExecutionResult = {
    response: "Website profile completed. Found e-commerce platform with 12 products.",
    toolCalls: [],
    tokenUsage: { input: 200, output: 100 },
    trace: {
      durationMs: 500,
      turnCount: 1,
      status: "success",
      responseSummary: "Website scan completed",
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

    // Mock Parameter Builder
    const mockProfilerBuilder: ParameterBuilder = vi.fn(async (ctx, _config, _stores) => ({
      TARGET_URL: "https://example.com",
      BUSINESS_NAME: ctx.persona.businessName,
      PERSONA_CONFIG: {
        tone: ctx.persona.tone,
      },
    }));

    // Mock Skill Runtime
    mockSkillRuntime = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn((_slug: string, _skillsDir: string) => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map<string, ParameterBuilder>([["website-profiler", mockProfilerBuilder]]),
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
      channel: "dashboard",
      token: "dashboard_token_123",
      sessionId: "session_456",
      text: "Scan https://example.com",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockDeploymentLookup.findByChannelToken).toHaveBeenCalledWith(
      "dashboard",
      "dashboard_token_123",
    );
    expect(mockConversationStore.getOrCreateBySession).toHaveBeenCalledWith(
      "deploy_profiler_test",
      "dashboard",
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
    expect(sentMessages[0]).toBe(
      "Website profile completed. Found e-commerce platform with 12 products.",
    );
  });

  it("loads website-profiler skill definition", async () => {
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
      channel: "dashboard",
      token: "dashboard_token_123",
      sessionId: "session_789",
      text: "Profile this website",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("website-profiler", "/mock/skills");
  });

  it("executes skill executor (not fallback LLM)", async () => {
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
      channel: "dashboard",
      token: "dashboard_token_123",
      sessionId: "session_abc",
      text: "Analyze https://test.com",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    expect(mockSkillExecutor.execute).toHaveBeenCalled();
  });

  it("skill definition includes web-scanner tool", async () => {
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
      channel: "dashboard",
      token: "dashboard_token_123",
      sessionId: "session_def",
      text: "Scan website",
    };

    // Act
    await gateway.handleIncoming(message, replySink);

    // Assert
    const executorCallArgs = vi.mocked(mockSkillExecutor.execute).mock.calls[0]?.[0];
    expect(executorCallArgs).toBeDefined();
    expect(executorCallArgs?.skill).toEqual(mockSkillDefinition);
    expect(executorCallArgs?.skill.tools).toContain("web-scanner");
  });
});
