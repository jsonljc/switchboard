import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ConversationLifecycleTracker,
  type ConversationEndHandler,
} from "../channel-gateway/conversation-lifecycle.js";

describe("ConversationLifecycleTracker", () => {
  let handler: ConversationEndHandler;
  let tracker: ConversationLifecycleTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    handler = vi.fn().mockResolvedValue(undefined);
    tracker = new ConversationLifecycleTracker({
      onConversationEnd: handler,
      inactivityTimeoutMs: 5000,
    });
  });

  it("fires end event after inactivity timeout", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-1",
        organizationId: "org-1",
        channelType: "telegram",
        endReason: "inactivity",
      }),
    );
  });

  it("resets timer on new message", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    vi.advanceTimersByTime(3000);
    expect(handler).not.toHaveBeenCalled();

    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "assistant",
      content: "Hi there!",
    });

    vi.advanceTimersByTime(3000);
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    await vi.runAllTimersAsync();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("tracks message count and computes duration", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    vi.advanceTimersByTime(2000);

    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "assistant",
      content: "Hi there!",
    });

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        messageCount: 2,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      }),
    );
  });

  it("fires end event on explicit close", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    await tracker.closeConversation("dep-1:telegram:session-1", "won");

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        endReason: "won",
      }),
    );
  });

  it("cleans up session after end event fires", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    expect(tracker.activeSessionCount).toBe(0);
  });
});
