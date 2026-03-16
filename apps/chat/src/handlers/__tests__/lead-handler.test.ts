import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleLeadMessage } from "../lead-handler.js";
import type { HandlerContext } from "../handler-context.js";
import type { ConversationRouter, RouterResponse } from "@switchboard/customer-engagement";
import type { IncomingMessage } from "@switchboard/schemas";
import type { ConversionBus } from "@switchboard/core";

// Mock conversation threads
vi.mock("../../conversation/threads.js", () => ({
  getThread: vi.fn().mockResolvedValue({
    id: "thread-1",
    crmContactId: "contact-123",
    messages: [],
  }),
  setThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../conversation/state.js", () => ({
  transitionConversation: vi.fn((c: unknown) => c),
}));

vi.mock("../../jobs/cadence-worker.js", () => ({
  startCadenceForContact: vi.fn(),
}));

function createMockCtx(): HandlerContext {
  return {
    adapter: {} as never,
    orchestrator: {
      resolveAndPropose: vi.fn().mockResolvedValue({ status: "proposed" }),
    } as never,
    readAdapter: null,
    storage: null,
    failedMessageStore: null,
    humanizer: { applyTerminology: (t: string) => t } as never,
    operatorState: { active: true, automationLevel: "supervised" },
    apiBaseUrl: null,
    composeResponse: vi.fn(),
    sendFilteredReply: vi.fn().mockResolvedValue(undefined),
    filterCardText: <T extends { summary: string; explanation?: string }>(card: T): T => card,
    recordAssistantMessage: vi.fn().mockResolvedValue(undefined),
    trackLastExecuted: vi.fn().mockResolvedValue(undefined),
    getLastExecutedEnvelopeId: vi.fn().mockResolvedValue(null),
  };
}

function createMockMessage(): IncomingMessage {
  return {
    id: "msg-1",
    channel: "telegram",
    channelMessageId: "chan-msg-1",
    threadId: null,
    text: "I want to book",
    principalId: "user-1",
    timestamp: new Date(),
    organizationId: "org-1",
    attachments: [],
  };
}

function mockRouterResponse(overrides: Partial<RouterResponse> = {}): RouterResponse {
  return {
    handled: true,
    responses: ["OK"],
    escalated: false,
    completed: false,
    sessionId: "session-1",
    ...overrides,
  };
}

describe("handleLeadMessage — ConversionBus wiring", () => {
  let ctx: HandlerContext;
  let conversionBus: ConversionBus;
  let mockRouter: ConversationRouter;

  beforeEach(() => {
    ctx = createMockCtx();
    conversionBus = {
      emit: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    };
  });

  it("emits to ConversionBus when qualification completes with score >= 50", async () => {
    mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Great, you're booked!"],
          completed: true,
          variables: { leadScore: "75", contactName: "Alice" },
          machineState: "qualified",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      conversionBus,
      crmProvider: {
        searchContacts: vi
          .fn()
          .mockResolvedValue([{ sourceAdId: "ad-123", sourceCampaignId: "camp-456" }]),
      } as never,
    });

    expect(conversionBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booked",
        contactId: "thread-1",
        organizationId: "org-1",
        sourceAdId: "ad-123",
        sourceCampaignId: "camp-456",
      }),
    );
  });

  it("emits 'qualified' to ConversionBus when qualification completes regardless of score", async () => {
    mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Thanks for the info."],
          completed: true,
          variables: { leadScore: "35" },
          machineState: "qualified",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      conversionBus,
    });

    expect(conversionBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "qualified" }));
  });

  it("does NOT emit 'booked' to ConversionBus when score < 50", async () => {
    mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Thanks for the info."],
          completed: true,
          variables: { leadScore: "30" },
          machineState: "qualified",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      conversionBus,
    });

    expect(conversionBus.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "booked" }),
    );
  });

  it("does NOT emit when conversionBus is not provided", async () => {
    mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Booked!"],
          completed: true,
          variables: { leadScore: "80" },
          machineState: "qualified",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {});
  });

  it("emits without attribution data when crmProvider is not provided", async () => {
    mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Booked!"],
          completed: true,
          variables: { leadScore: "60" },
          machineState: "qualified",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      conversionBus,
    });

    expect(conversionBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booked",
        sourceAdId: undefined,
        sourceCampaignId: undefined,
      }),
    );
  });

  it("emits 'lost' outcome when qualification completes with score < 50", async () => {
    const outcomePipeline = {
      emitOutcome: vi.fn().mockResolvedValue({}),
      logResponseVariant: vi.fn().mockResolvedValue({}),
    };

    mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Thanks for your interest."],
          completed: true,
          variables: { leadScore: "25" },
          machineState: "qualified",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      outcomePipeline: outcomePipeline as never,
    });

    expect(outcomePipeline.emitOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeType: "lost",
        metadata: expect.objectContaining({ leadScore: 25, reason: "low_qualification_score" }),
      }),
    );
  });
});

describe("handleLeadMessage — state transition outcomes", () => {
  let ctx: HandlerContext;
  let mockRouter: ConversationRouter;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("emits 'escalated_resolved' when transitioning from HUMAN_ACTIVE to REACTIVATION", async () => {
    const outcomePipeline = {
      emitOutcome: vi.fn().mockResolvedValue({}),
      logResponseVariant: vi.fn().mockResolvedValue({}),
    };

    // Mock thread with previous HUMAN_ACTIVE state
    const { getThread } = await import("../../conversation/threads.js");
    (getThread as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "thread-1",
      crmContactId: "contact-123",
      messages: [],
      machineState: "HUMAN_ACTIVE",
    });

    mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Welcome back! How can I help?"],
          machineState: "REACTIVATION",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      outcomePipeline: outcomePipeline as never,
    });

    expect(outcomePipeline.emitOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeType: "escalated_resolved",
        metadata: expect.objectContaining({ previousState: "HUMAN_ACTIVE" }),
      }),
    );
  });

  it("emits 'reactivated' when transitioning from CLOSED_UNRESPONSIVE to REACTIVATION", async () => {
    const outcomePipeline = {
      emitOutcome: vi.fn().mockResolvedValue({}),
      logResponseVariant: vi.fn().mockResolvedValue({}),
    };

    const { getThread } = await import("../../conversation/threads.js");
    (getThread as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "thread-1",
      crmContactId: "contact-123",
      messages: [],
      machineState: "CLOSED_UNRESPONSIVE",
    });

    mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Welcome back!"],
          machineState: "REACTIVATION",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      outcomePipeline: outcomePipeline as never,
    });

    expect(outcomePipeline.emitOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeType: "reactivated",
        metadata: expect.objectContaining({ previousState: "CLOSED_UNRESPONSIVE" }),
      }),
    );
  });
});

describe("handleLeadMessage — LLM engine integration", () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("uses LLM engine response when engine is available and succeeds", async () => {
    const llmEngine = {
      generate: vi.fn().mockResolvedValue({
        text: "Hey there! What brings you in today?",
        usedLLM: true,
        usage: { promptTokens: 100, completionTokens: 15 },
      }),
    };

    const mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Template greeting"],
          machineState: "GREETING",
          stateGoal: "Build rapport, understand why they're reaching out",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      llmEngine: llmEngine as never,
      businessProfile: { businessName: "Glow Clinic", personaName: "Sarah" },
    });

    // Should send LLM response, not template
    expect(ctx.sendFilteredReply).toHaveBeenCalledWith(
      "thread-1",
      "Hey there! What brings you in today?",
    );
    expect(ctx.sendFilteredReply).not.toHaveBeenCalledWith("thread-1", "Template greeting");
  });

  it("falls back to template when LLM engine fails", async () => {
    const llmEngine = {
      generate: vi.fn().mockResolvedValue({
        text: "Hi! This is Sarah from Glow Clinic. How can I help you today?",
        usedLLM: false,
      }),
    };

    const mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Template greeting"],
          machineState: "GREETING",
          stateGoal: "Build rapport",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
      llmEngine: llmEngine as never,
      businessProfile: { businessName: "Glow Clinic", personaName: "Sarah" },
    });

    // Should fall back to template responses
    expect(ctx.sendFilteredReply).toHaveBeenCalledWith("thread-1", "Template greeting");
  });

  it("uses template responses when no LLM engine provided", async () => {
    const mockRouter = {
      handleMessage: vi.fn().mockResolvedValue(
        mockRouterResponse({
          responses: ["Template greeting"],
          machineState: "GREETING",
          stateGoal: "Build rapport",
        }),
      ),
    } as unknown as ConversationRouter;

    await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {});

    expect(ctx.sendFilteredReply).toHaveBeenCalledWith("thread-1", "Template greeting");
  });
});
