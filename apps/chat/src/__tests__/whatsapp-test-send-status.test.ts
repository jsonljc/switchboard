import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildWhatsAppStatusBridge } from "../bridges/whatsapp-test-send-status-bridge.js";

describe("WhatsApp test-send status bridge", () => {
  let updateWebhookStatus: ReturnType<typeof vi.fn>;
  let testSendStore: { updateWebhookStatus: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    updateWebhookStatus = vi.fn().mockResolvedValue(null);
    testSendStore = { updateWebhookStatus };
  });

  it("calls testSendStore.updateWebhookStatus for delivered status with timestamp", async () => {
    const bridge = buildWhatsAppStatusBridge({ testSendStore: testSendStore as never });
    const timestamp = new Date("2026-05-15T12:00:00.000Z");

    await bridge.onStatusUpdate(
      {
        messageId: "wamid.abc123",
        recipientId: "15551234567",
        status: "delivered",
        timestamp,
      },
      "org_test",
    );

    expect(updateWebhookStatus).toHaveBeenCalledTimes(1);
    expect(updateWebhookStatus).toHaveBeenCalledWith({
      messageId: "wamid.abc123",
      status: "delivered",
      at: timestamp,
      organizationId: "org_test",
    });
  });

  it("does not throw and does not call the store for an unknown status", async () => {
    const bridge = buildWhatsAppStatusBridge({ testSendStore: testSendStore as never });

    await expect(
      bridge.onStatusUpdate(
        {
          messageId: "wamid.weird",
          recipientId: "15551234567",
          status: "weird",
          timestamp: new Date(),
        },
        "org_test",
      ),
    ).resolves.toBeUndefined();

    expect(updateWebhookStatus).not.toHaveBeenCalled();
  });

  it.each(["sent", "read", "failed"] as const)("calls the store for status=%s", async (status) => {
    const bridge = buildWhatsAppStatusBridge({ testSendStore: testSendStore as never });
    const timestamp = new Date("2026-05-15T12:30:00.000Z");

    await bridge.onStatusUpdate(
      {
        messageId: `wamid.${status}`,
        recipientId: "15551234567",
        status,
        timestamp,
      },
      "org_test",
    );

    expect(updateWebhookStatus).toHaveBeenCalledTimes(1);
    expect(updateWebhookStatus).toHaveBeenCalledWith({
      messageId: `wamid.${status}`,
      status,
      at: timestamp,
      organizationId: "org_test",
    });
  });

  it("ignores empty-string status without calling the store", async () => {
    const bridge = buildWhatsAppStatusBridge({ testSendStore: testSendStore as never });

    await bridge.onStatusUpdate(
      {
        messageId: "wamid.empty",
        recipientId: "15551234567",
        status: "",
        timestamp: new Date(),
      },
      "org_test",
    );

    expect(updateWebhookStatus).not.toHaveBeenCalled();
  });

  it("propagates store rejections so the caller can log them (does not swallow)", async () => {
    updateWebhookStatus.mockRejectedValueOnce(new Error("db down"));
    const bridge = buildWhatsAppStatusBridge({ testSendStore: testSendStore as never });

    await expect(
      bridge.onStatusUpdate(
        {
          messageId: "wamid.boom",
          recipientId: "15551234567",
          status: "delivered",
          timestamp: new Date(),
        },
        "org_test",
      ),
    ).rejects.toThrow("db down");
  });

  it("passes organizationId unconditionally even when orgId is empty string", async () => {
    const bridge = buildWhatsAppStatusBridge({ testSendStore: testSendStore as never });
    const timestamp = new Date("2026-05-15T13:00:00.000Z");

    await bridge.onStatusUpdate(
      {
        messageId: "wamid.no-org",
        recipientId: "15551234567",
        status: "delivered",
        timestamp,
      },
      "",
    );

    expect(updateWebhookStatus).toHaveBeenCalledWith({
      messageId: "wamid.no-org",
      status: "delivered",
      at: timestamp,
      organizationId: "",
    });
  });
});
