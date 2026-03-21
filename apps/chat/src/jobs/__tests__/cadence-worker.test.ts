import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startCadenceWorker,
  registerCadenceDefinition,
  startCadenceForContact,
} from "../cadence-worker.js";
import type { AgentNotifier } from "@switchboard/core";
import type { CadenceDefinition, CadenceInstance } from "@switchboard/customer-engagement";
import { setThread, deleteThread } from "../../conversation/threads.js";
import { createConversation } from "../../conversation/state.js";

function createMockNotifier(): AgentNotifier & { calls: Array<[string, string, string]> } {
  const calls: Array<[string, string, string]> = [];
  return {
    calls,
    sendProactive: vi.fn(async (chatId: string, channelType: string, message: string) => {
      calls.push([chatId, channelType, message]);
    }),
  };
}

function createTestDefinition(): CadenceDefinition {
  return {
    id: "test-followup",
    name: "Test Follow-up",
    description: "Test cadence",
    trigger: { event: "test_event" },
    steps: [
      {
        index: 0,
        actionType: "customer-engagement.reminder.send",
        delayMs: 0, // immediate
        parameters: { message: "Hey {{contactName}}, just following up!" },
      },
      {
        index: 1,
        actionType: "customer-engagement.reminder.send",
        delayMs: 24 * 60 * 60 * 1000, // 24 hours
        parameters: { message: "Hi {{contactName}}, any updates?" },
      },
    ],
  };
}

function createTestInstance(overrides?: Partial<CadenceInstance>): CadenceInstance {
  return {
    id: `ci_${Date.now()}`,
    cadenceDefinitionId: "test-followup",
    contactId: "15551234567",
    organizationId: "org_test",
    status: "active",
    currentStepIndex: 0,
    startedAt: new Date(),
    nextExecutionAt: new Date(Date.now() - 1000), // due now
    variables: { contactName: "Jane" },
    completedSteps: [],
    skippedSteps: [],
    ...overrides,
  };
}

describe("CadenceWorker", () => {
  let notifier: ReturnType<typeof createMockNotifier>;

  beforeEach(() => {
    notifier = createMockNotifier();
    registerCadenceDefinition(createTestDefinition());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts and can be stopped without error", () => {
    const stop = startCadenceWorker({
      notifier,
      intervalMs: 60_000, // long interval to avoid multiple cycles in test
    });
    expect(typeof stop).toBe("function");
    stop();
  });

  it("evaluates and dispatches due cadence steps", async () => {
    // Set up a conversation thread so the worker can resolve the channel
    const contactId = "tg_user_123";
    const conv = createConversation(contactId, "telegram", contactId);
    conv.lastInboundAt = new Date(); // within window
    await setThread(conv);

    const instance = createTestInstance({ contactId });
    startCadenceForContact(instance);

    const stop = startCadenceWorker({
      notifier,
      intervalMs: 100_000, // prevent second cycle
    });

    // Wait for the first cycle to complete (includes dynamic import)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The notifier should have been called with the interpolated message
    expect(notifier.sendProactive).toHaveBeenCalled();
    const [chatId, , message] = notifier.calls[0]!;
    expect(chatId).toBe(contactId);
    expect(message).toContain("Jane");

    stop();
    await deleteThread(contactId);
  });

  it("skips cadence steps that are not yet due", async () => {
    const instance = createTestInstance({
      nextExecutionAt: new Date(Date.now() + 60_000), // due in 1 minute
    });
    startCadenceForContact(instance);

    const stop = startCadenceWorker({
      notifier,
      intervalMs: 100_000,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(notifier.sendProactive).not.toHaveBeenCalled();

    stop();
  });
});
