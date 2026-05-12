import { describe, expect, it, vi } from "vitest";
import { onThreadFirstObservation } from "../../event-hooks/thread-init-hook.js";

describe("onThreadFirstObservation", () => {
  it("seeds null → active when no snapshot exists", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    const snapshotStore = { read: vi.fn().mockResolvedValue(null) };
    await onThreadFirstObservation(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        observedAt: new Date(),
        observationKind: "inbound_message",
      },
    );
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "active",
        trigger: "inbound_after_stalled",
        actor: "system",
        evidence: { observation_kind: "inbound_message" },
      }),
    );
  });

  it("is a no-op when snapshot already exists (idempotent)", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    const snapshotStore = {
      read: vi.fn().mockResolvedValue({ currentState: "active" }),
    };
    await onThreadFirstObservation(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        observedAt: new Date(),
        observationKind: "inbound_message",
      },
    );
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("no-ops when flag mode is off", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    const snapshotStore = { read: vi.fn() };
    await onThreadFirstObservation(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      async () => "off",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        observedAt: new Date(),
        observationKind: "inbound_message",
      },
    );
    expect(recordTransition).not.toHaveBeenCalled();
    expect(snapshotStore.read).not.toHaveBeenCalled();
  });
});
