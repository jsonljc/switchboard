import { describe, expect, it, vi } from "vitest";
import { onInboundMessage } from "../../event-hooks/inbound-message-hook.js";

describe("onInboundMessage", () => {
  it("transitions stalled → active when no re-engagement outbound in window", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn().mockResolvedValue({ currentState: "stalled" }) };
    const attributor = {
      attributeReOpen: vi
        .fn()
        .mockResolvedValue({ trigger: "inbound_after_stalled", evidence: {} }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributor as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "active",
        trigger: "inbound_after_stalled",
      }),
    );
  });

  it("uses inbound_after_re_engagement_template when attributor finds an outbound", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn().mockResolvedValue({ currentState: "stalled" }) };
    const attributor = {
      attributeReOpen: vi.fn().mockResolvedValue({
        trigger: "inbound_after_re_engagement_template",
        evidence: { template_id: "re_engagement_offer_sg_v1" },
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributor as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "active",
        trigger: "inbound_after_re_engagement_template",
        evidence: { template_id: "re_engagement_offer_sg_v1" },
      }),
    );
  });

  it("no-ops when current state is not stalled", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn().mockResolvedValue({ currentState: "active" }) };
    const attributor = { attributeReOpen: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributor as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).not.toHaveBeenCalled();
    expect(attributor.attributeReOpen).not.toHaveBeenCalled();
  });

  it("no-ops when no snapshot exists (thread first contact)", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn().mockResolvedValue(null) };
    const attributor = { attributeReOpen: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributor as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("no-ops when flag mode is off", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn() };
    const attributor = { attributeReOpen: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributor as any,
      async () => "off",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).not.toHaveBeenCalled();
    expect(snapshotStore.read).not.toHaveBeenCalled();
  });
});
