import { describe, expect, it, vi } from "vitest";
import { runStalledSweep } from "../../cron/stalled-sweep.js";

describe("runStalledSweep", () => {
  it("marks a thread stalled when last outbound is >24h ago and no inbound after", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    const now = new Date("2026-05-12T12:00:00Z");
    const listNonTerminalSnapshots = vi.fn().mockResolvedValue([
      {
        conversationThreadId: "t-1",
        organizationId: "org-1",
        contactId: "c-1",
        currentState: "active",
      },
    ]);
    const history = {
      read: vi.fn().mockResolvedValue({
        lastAlexOutboundAt: new Date("2026-05-11T09:00:00Z"), // ~27h before now
        lastInboundAt: new Date("2026-05-11T08:55:00Z"),
      }),
    };
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history: history as any,
      readMode: async () => "on",
      now,
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "stalled",
        trigger: "timer_24h_no_inbound",
      }),
    );
  });

  it("does not mark stalled when an inbound came after the outbound", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    const now = new Date("2026-05-12T12:00:00Z");
    const listNonTerminalSnapshots = vi.fn().mockResolvedValue([
      {
        conversationThreadId: "t-1",
        organizationId: "org-1",
        contactId: "c-1",
        currentState: "active",
      },
    ]);
    const history = {
      read: vi.fn().mockResolvedValue({
        lastAlexOutboundAt: new Date("2026-05-11T09:00:00Z"),
        lastInboundAt: new Date("2026-05-11T10:00:00Z"),
      }),
    };
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history: history as any,
      readMode: async () => "on",
      now,
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("skips candidates already in stalled or other non-active states", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    const now = new Date("2026-05-12T12:00:00Z");
    const listNonTerminalSnapshots = vi.fn().mockResolvedValue([
      {
        conversationThreadId: "t-1",
        organizationId: "org-1",
        contactId: "c-1",
        currentState: "stalled",
      },
    ]);
    const history = {
      read: vi.fn().mockResolvedValue({
        lastAlexOutboundAt: new Date("2026-05-11T09:00:00Z"),
        lastInboundAt: null,
      }),
    };
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history: history as any,
      readMode: async () => "on",
      now,
    });
    expect(recordTransition).not.toHaveBeenCalled();
    expect(history.read).not.toHaveBeenCalled();
  });

  it("calls writer for none of the candidates when readMode returns off for every org", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    const listNonTerminalSnapshots = vi.fn().mockResolvedValue([
      {
        conversationThreadId: "t-1",
        organizationId: "org-1",
        contactId: "c-1",
        currentState: "active",
      },
    ]);
    const history = { read: vi.fn() };
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history: history as any,
      readMode: async () => "off",
      now: new Date(),
    });
    expect(recordTransition).not.toHaveBeenCalled();
    expect(history.read).not.toHaveBeenCalled();
  });
});
