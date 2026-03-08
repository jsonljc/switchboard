import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handleStatusCommand,
  handlePauseCommand,
  handleResumeCommand,
  handleAutonomyCommand,
  handleAutonomyStatusCommand,
} from "../handlers/cockpit-commands.js";
import type { HandlerContext } from "../handlers/handler-context.js";
import type { ChannelAdapter } from "../adapters/adapter.js";
import type { ResponseHumanizer } from "../composer/humanize.js";
import type { RuntimeOrchestrator } from "@switchboard/core";

// ---------------------------------------------------------------------------
// Mock HandlerContext factory
// ---------------------------------------------------------------------------
function createMockContext(): HandlerContext {
  return {
    adapter: {} as ChannelAdapter,
    orchestrator: {} as RuntimeOrchestrator,
    readAdapter: null,
    storage: null,
    failedMessageStore: null,
    humanizer: {} as ResponseHumanizer,
    operatorState: { active: true, automationLevel: "supervised" },
    apiBaseUrl: null,
    composeResponse: vi.fn(),
    sendFilteredReply: vi.fn(),
    filterCardText: vi.fn((card) => card),
    recordAssistantMessage: vi.fn(),
    trackLastExecuted: vi.fn(),
    getLastExecutedEnvelopeId: vi.fn(),
  } as unknown as HandlerContext;
}

/** Extract the text passed to the first sendFilteredReply call. */
function getReplyText(ctx: HandlerContext): string {
  const mock = ctx.sendFilteredReply as ReturnType<typeof vi.fn>;
  expect(mock).toHaveBeenCalled();
  return mock.mock.calls[0]![1] as string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleStatusCommand", () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("shows current status and automation level", async () => {
    await handleStatusCommand(ctx, "thread_1", "principal_1", null);

    const reply = getReplyText(ctx);
    expect(reply).toContain("Agent Status");
    expect(reply).toContain("Active");
    expect(reply).toContain("supervised");
    expect(reply).toContain("Commands:");
    expect(reply).toContain("/autonomy-status");
  });

  it("shows paused status when operator is paused", async () => {
    ctx.operatorState.active = false;

    await handleStatusCommand(ctx, "thread_1", "principal_1", "org_1");

    const reply = getReplyText(ctx);
    expect(reply).toContain("Paused");
  });

  it("lists all agents", async () => {
    await handleStatusCommand(ctx, "thread_1", "principal_1", "org_1");

    const reply = getReplyText(ctx);
    expect(reply).toContain("Optimizer");
    expect(reply).toContain("Reporter");
    expect(reply).toContain("Guardrail");
  });
});

describe("handlePauseCommand", () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("pauses and acknowledges", async () => {
    await handlePauseCommand(ctx, "thread_1", "principal_1", "org_1");

    expect(ctx.operatorState.active).toBe(false);
    const reply = getReplyText(ctx);
    expect(reply.toLowerCase()).toContain("paused");
    expect(reply).toContain("/resume");
  });

  it("reports already paused when already inactive", async () => {
    ctx.operatorState.active = false;

    await handlePauseCommand(ctx, "thread_1", "principal_1", "org_1");

    expect(ctx.operatorState.active).toBe(false);
    const reply = getReplyText(ctx);
    expect(reply).toContain("already paused");
  });
});

describe("handleResumeCommand", () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("resumes and acknowledges", async () => {
    ctx.operatorState.active = false;

    await handleResumeCommand(ctx, "thread_1", "principal_1", "org_1");

    expect(ctx.operatorState.active).toBe(true);
    const reply = getReplyText(ctx);
    expect(reply.toLowerCase()).toContain("resumed");
  });

  it("reports already running when already active", async () => {
    await handleResumeCommand(ctx, "thread_1", "principal_1", "org_1");

    expect(ctx.operatorState.active).toBe(true);
    const reply = getReplyText(ctx);
    expect(reply).toContain("already running");
  });
});

describe("handleAutonomyCommand", () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("shows current level and options when no level provided", async () => {
    await handleAutonomyCommand(ctx, "thread_1", "principal_1", "org_1");

    const reply = getReplyText(ctx);
    expect(reply).toContain("Current level: supervised");
    expect(reply).toContain("copilot");
    expect(reply).toContain("autonomous");
  });

  it("updates automation level on valid input", async () => {
    await handleAutonomyCommand(ctx, "thread_1", "principal_1", "org_1", "autonomous");

    expect(ctx.operatorState.automationLevel).toBe("autonomous");
    const reply = getReplyText(ctx);
    expect(reply).toContain("autonomous");
    expect(reply).toContain("auto-execute");
  });

  it("rejects invalid level", async () => {
    await handleAutonomyCommand(ctx, "thread_1", "principal_1", "org_1", "invalid");

    expect(ctx.operatorState.automationLevel).toBe("supervised"); // unchanged
    const reply = getReplyText(ctx);
    expect(reply).toContain("Invalid level");
  });

  it("normalizes case", async () => {
    await handleAutonomyCommand(ctx, "thread_1", "principal_1", "org_1", "COPILOT");

    expect(ctx.operatorState.automationLevel).toBe("copilot");
    const reply = getReplyText(ctx);
    expect(reply).toContain("copilot");
  });
});

describe("handleAutonomyStatusCommand", () => {
  let ctx: HandlerContext;
  let mockFetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ctx = createMockContext();
    mockFetchFn = vi.fn();
    vi.stubGlobal("fetch", mockFetchFn);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows fallback when no apiBaseUrl", async () => {
    await handleAutonomyStatusCommand(ctx, "thread_1", "principal_1", null);

    const reply = getReplyText(ctx);
    expect(reply).toContain("supervised");
    expect(reply).toContain("dev mode");
  });

  it("shows assessment from API", async () => {
    ctx.apiBaseUrl = "http://localhost:3000";
    mockFetchFn.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          assessment: {
            currentProfile: "guarded",
            recommendedProfile: "observe",
            autonomousEligible: false,
            reason: "10 successful adjustments with score 65. Ready for observe mode.",
            progressPercent: 100,
            stats: {
              totalSuccesses: 10,
              totalFailures: 1,
              competenceScore: 65,
              failureRate: 0.09,
            },
          },
        }),
    });

    await handleAutonomyStatusCommand(ctx, "thread_1", "principal_1", "org_1");

    const reply = getReplyText(ctx);
    expect(reply).toContain("Autonomy Assessment");
    expect(reply).toContain("guarded");
    expect(reply).toContain("observe");
    expect(reply).toContain("100%");
    expect(reply).toContain("10 successes");
    expect(reply).toContain("1 failures");
    expect(reply).toContain("65");
  });

  it("handles API errors gracefully", async () => {
    ctx.apiBaseUrl = "http://localhost:3000";
    mockFetchFn.mockResolvedValue({ ok: false, status: 500 });

    await handleAutonomyStatusCommand(ctx, "thread_1", "principal_1", "org_1");

    const reply = getReplyText(ctx);
    expect(reply).toContain("supervised");
    expect(reply).toContain("500");
  });

  it("handles network errors gracefully", async () => {
    ctx.apiBaseUrl = "http://localhost:3000";
    mockFetchFn.mockRejectedValue(new Error("connection refused"));

    await handleAutonomyStatusCommand(ctx, "thread_1", "principal_1", "org_1");

    const reply = getReplyText(ctx);
    expect(reply).toContain("Could not reach");
  });
});
