import { describe, it, expect } from "vitest";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

const adapter = new WhatsAppAdapter({
  token: "test_token",
  phoneNumberId: "123456789",
  appSecret: "test_secret",
});

function buildStatusPayload(
  status: string,
  messageId: string,
  options?: { errorCode?: string; errorTitle?: string; category?: string },
) {
  const statusObj: Record<string, unknown> = {
    id: messageId,
    recipient_id: "15551234567",
    status,
    timestamp: "1700000000",
  };
  if (status === "failed" && options?.errorCode) {
    statusObj["errors"] = [{ code: options.errorCode, title: options.errorTitle }];
  }
  if (options?.category) {
    statusObj["pricing"] = {
      pricing_model: "PMP",
      billable: true,
      category: options.category,
    };
  }
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1234567890", phone_number_id: "123456789" },
              statuses: [statusObj],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

describe("WhatsAppAdapter — status parsing", () => {
  it("should parse a delivered status", () => {
    const payload = buildStatusPayload("delivered", "wamid.abc123");
    const result = adapter.parseStatusUpdate(payload);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe("wamid.abc123");
    expect(result!.status).toBe("delivered");
    expect(result!.recipientId).toBe("15551234567");
    expect(result!.timestamp).toEqual(new Date(1700000000 * 1000));
  });

  it("should parse a failed status with error details", () => {
    const payload = buildStatusPayload("failed", "wamid.fail1", {
      errorCode: "131031",
      errorTitle: "Business Account locked",
    });
    const result = adapter.parseStatusUpdate(payload);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("failed");
    expect(result!.errorCode).toBe("131031");
    expect(result!.errorTitle).toBe("Business Account locked");
  });

  it("should parse pricing info from status", () => {
    const payload = buildStatusPayload("sent", "wamid.sent1", { category: "utility" });
    const result = adapter.parseStatusUpdate(payload);
    expect(result).not.toBeNull();
    expect(result!.pricingCategory).toBe("utility");
    expect(result!.billable).toBe(true);
  });

  it("should return null for message payloads (no statuses)", () => {
    const messagePayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "15551234567", id: "wamid.msg1", type: "text", text: { body: "hi" } },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(adapter.parseStatusUpdate(messagePayload)).toBeNull();
  });

  it("should return null for empty payload", () => {
    expect(adapter.parseStatusUpdate(null)).toBeNull();
    expect(adapter.parseStatusUpdate({})).toBeNull();
  });
});
