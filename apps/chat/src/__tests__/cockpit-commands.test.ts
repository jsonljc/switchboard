import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleStatusCommand,
  handlePauseCommand,
  handleResumeCommand,
  handleAutonomyCommand,
} from "../handlers/cockpit-commands.js";
import type { HandlerContext } from "../handlers/handler-context.js";
import type { ChannelAdapter } from "../adapters/adapter.js";
import type { ResponseHumanizer } from "../composer/humanize.js";
import type { RuntimeOrchestrator, StorageContext } from "@switchboard/core";

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

  it("shows status with available commands", async () => {
    ctx.storage = {} as unknown as StorageContext;

    await handleStatusCommand(ctx, "thread_1", "principal_1", null);

    const reply = getReplyText(ctx);
    expect(reply).toContain("Agent Status");
    expect(reply).toContain("Commands:");
  });

  it("shows setup message when storage is null", async () => {
    await handleStatusCommand(ctx, "thread_1", "principal_1", null);

    const reply = getReplyText(ctx);
    expect(reply).toContain("No agent configuration found");
  });

  it("shows agent list when storage exists", async () => {
    ctx.storage = {} as unknown as StorageContext;

    await handleStatusCommand(ctx, "thread_1", "principal_1", "org_1");

    const reply = getReplyText(ctx);
    expect(reply).toContain("Optimizer");
    expect(reply).toContain("Reporter");
  });
});

describe("handlePauseCommand", () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("acknowledges pause", async () => {
    await handlePauseCommand(ctx, "thread_1", "principal_1");

    const reply = getReplyText(ctx);
    expect(reply.toLowerCase()).toContain("paused");
    expect(reply).toContain("/resume");
  });
});

describe("handleResumeCommand", () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("acknowledges resume", async () => {
    await handleResumeCommand(ctx, "thread_1", "principal_1");

    const reply = getReplyText(ctx);
    expect(reply.toLowerCase()).toContain("resumed");
  });
});

describe("handleAutonomyCommand", () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("shows options when no level provided", async () => {
    await handleAutonomyCommand(ctx, "thread_1", "principal_1");

    const reply = getReplyText(ctx);
    expect(reply).toContain("copilot");
    expect(reply).toContain("supervised");
    expect(reply).toContain("autonomous");
  });

  it("accepts valid level", async () => {
    await handleAutonomyCommand(ctx, "thread_1", "principal_1", "supervised");

    const reply = getReplyText(ctx);
    expect(reply).toContain("supervised");
  });

  it("rejects invalid level", async () => {
    await handleAutonomyCommand(ctx, "thread_1", "principal_1", "invalid");

    const reply = getReplyText(ctx);
    expect(reply).toContain("Invalid level");
  });

  it("normalizes case", async () => {
    await handleAutonomyCommand(ctx, "thread_1", "principal_1", "COPILOT");

    const reply = getReplyText(ctx);
    expect(reply).toContain("copilot");
  });
});
