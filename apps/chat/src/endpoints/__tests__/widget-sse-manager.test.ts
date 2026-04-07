import { describe, it, expect, vi, beforeEach } from "vitest";
import { SseSessionManager } from "../widget-sse-manager.js";

function createMockReply() {
  return {
    raw: {
      write: vi.fn().mockReturnValue(true),
    },
  };
}

describe("SseSessionManager", () => {
  let manager: SseSessionManager;

  beforeEach(() => {
    manager = new SseSessionManager();
    vi.useFakeTimers();
  });

  it("registers a session and sends connected event", () => {
    const reply = createMockReply();
    manager.register("sess-1", reply as never);

    expect(manager.has("sess-1")).toBe(true);
    expect(manager.size).toBe(1);
    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("event: connected"));
  });

  it("sends message event", () => {
    const reply = createMockReply();
    manager.register("sess-1", reply as never);
    reply.raw.write.mockClear();

    manager.sendMessage("sess-1", "assistant", "Hello!");

    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("event: message"));
    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("Hello!"));
  });

  it("sends typing event", () => {
    const reply = createMockReply();
    manager.register("sess-1", reply as never);
    reply.raw.write.mockClear();

    manager.sendTyping("sess-1");

    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("event: typing"));
  });

  it("removes session", () => {
    const reply = createMockReply();
    manager.register("sess-1", reply as never);
    manager.remove("sess-1");

    expect(manager.has("sess-1")).toBe(false);
    expect(manager.size).toBe(0);
  });

  it("replaces existing connection on re-register", () => {
    const reply1 = createMockReply();
    const reply2 = createMockReply();
    manager.register("sess-1", reply1 as never);
    manager.register("sess-1", reply2 as never);

    expect(manager.size).toBe(1);
    manager.sendMessage("sess-1", "assistant", "test");
    expect(reply2.raw.write).toHaveBeenCalled();
  });

  it("ignores sends to unknown sessions", () => {
    // Should not throw
    manager.sendMessage("unknown", "assistant", "test");
    manager.sendTyping("unknown");
    manager.sendError("unknown", "test");
  });
});
