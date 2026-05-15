import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture constructor arguments + lifecycle tracker handler so we can assert
// the composition root wires bookingStore into ConversationCompoundingService
// and routes ConversationLifecycleTracker.onConversationEnd through to the
// compounding service's processConversationEnd (which sees endedAt).
const compoundingCtorArgs: unknown[] = [];
const processConversationEndMock = vi.fn();
let capturedLifecycleHandler: ((event: unknown) => Promise<void>) | null = null;
let capturedOnMessageRecorded: ((info: Record<string, unknown>) => void) | null = null;
const lifecycleRecordMessageSpy = vi.fn();

vi.mock("@switchboard/core", async () => {
  const actual = await vi.importActual<typeof import("@switchboard/core")>("@switchboard/core");
  return {
    ...actual,
    ConversationCompoundingService: vi.fn().mockImplementation((deps: unknown) => {
      compoundingCtorArgs.push(deps);
      return {
        processConversationEnd: processConversationEndMock,
      };
    }),
    ConversationLifecycleTracker: vi
      .fn()
      .mockImplementation((config: { onConversationEnd: (e: unknown) => Promise<void> }) => {
        capturedLifecycleHandler = config.onConversationEnd;
        return {
          recordMessage: lifecycleRecordMessageSpy,
        };
      }),
    ChannelGateway: vi
      .fn()
      .mockImplementation((config: { onMessageRecorded?: typeof capturedOnMessageRecorded }) => {
        capturedOnMessageRecorded = config.onMessageRecorded ?? null;
        return { config };
      }),
  };
});

vi.mock("@switchboard/db", async () => {
  const actual = await vi.importActual<typeof import("@switchboard/db")>("@switchboard/db");
  return {
    ...actual,
    // Re-export everything; concrete stores are constructed against a fake
    // prisma, so they're noop classes here at runtime.
  };
});

describe("createGatewayBridge — outcome attribution wiring (Task 20)", () => {
  beforeEach(() => {
    compoundingCtorArgs.length = 0;
    processConversationEndMock.mockReset();
    capturedLifecycleHandler = null;
    capturedOnMessageRecorded = null;
    lifecycleRecordMessageSpy.mockReset();
  });

  it("constructs ConversationCompoundingService with a BookingAttributionStore (bookingStore dep)", async () => {
    const { createGatewayBridge } = await import("../gateway-bridge.js");
    const fakePrisma = {} as never;
    const fakeIngress = { submit: vi.fn() };

    createGatewayBridge(fakePrisma, { platformIngress: fakeIngress });

    expect(compoundingCtorArgs.length).toBe(1);
    const deps = compoundingCtorArgs[0] as { bookingStore?: unknown };
    expect(deps.bookingStore).toBeDefined();
    // The Prisma-backed implementation exposes the canonical two methods.
    expect(typeof (deps.bookingStore as { findByWorkTraceIds: unknown }).findByWorkTraceIds).toBe(
      "function",
    );
    expect(typeof (deps.bookingStore as { findInWindow: unknown }).findInWindow).toBe("function");
  });

  it("forwards ConversationEndEvent to compoundingService.processConversationEnd via the lifecycle handler", async () => {
    const { createGatewayBridge } = await import("../gateway-bridge.js");
    const fakePrisma = {} as never;
    const fakeIngress = { submit: vi.fn() };

    createGatewayBridge(fakePrisma, { platformIngress: fakeIngress });

    expect(capturedLifecycleHandler).not.toBeNull();

    // Lifecycle tracker fires events shaped per ConversationEndEvent with
    // `endedAt` populated by fireEnd() (Task 15). The bridge handler must
    // pass them through unchanged.
    const event = {
      deploymentId: "dep_1",
      organizationId: "org_1",
      contactId: "ct_1",
      channelType: "telegram",
      sessionId: "ses_1",
      messages: [],
      duration: 30,
      messageCount: 2,
      endReason: "inactivity",
      endedAt: new Date("2026-05-14T10:00:00Z"),
    };

    await capturedLifecycleHandler!(event);

    expect(processConversationEndMock).toHaveBeenCalledTimes(1);
    expect(processConversationEndMock).toHaveBeenCalledWith(
      expect.objectContaining({ endedAt: expect.any(Date) }),
    );
  });

  it("forwards workTraceId from assistant-turn onMessageRecorded to lifecycleTracker.recordMessage", async () => {
    const { createGatewayBridge } = await import("../gateway-bridge.js");
    const fakePrisma = {} as never;
    const fakeIngress = { submit: vi.fn() };

    createGatewayBridge(fakePrisma, { platformIngress: fakeIngress });

    expect(capturedOnMessageRecorded).not.toBeNull();

    capturedOnMessageRecorded!({
      deploymentId: "dep_1",
      listingId: "list_1",
      organizationId: "org_1",
      channel: "telegram",
      sessionId: "ses_1",
      role: "assistant",
      content: "Hi there",
      workTraceId: "wt-X",
    });

    expect(lifecycleRecordMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Hi there",
        workTraceId: "wt-X",
      }),
    );
  });

  it("does not add workTraceId when forwarding a user-turn message to lifecycleTracker.recordMessage", async () => {
    const { createGatewayBridge } = await import("../gateway-bridge.js");
    const fakePrisma = {} as never;
    const fakeIngress = { submit: vi.fn() };

    createGatewayBridge(fakePrisma, { platformIngress: fakeIngress });

    expect(capturedOnMessageRecorded).not.toBeNull();

    capturedOnMessageRecorded!({
      deploymentId: "dep_1",
      listingId: "list_1",
      organizationId: "org_1",
      channel: "telegram",
      sessionId: "ses_1",
      role: "user",
      content: "Hello",
      // NOTE: no workTraceId field — pins that user turns stay text events.
    });

    const call = lifecycleRecordMessageSpy.mock.calls[0]!;
    const recordArg = call[0] as { workTraceId?: string };
    expect(recordArg.workTraceId).toBeUndefined();
  });
});
