import { describe, it, expect } from "vitest";
import {
  WhatsAppSendTestRequestSchema,
  WhatsAppSendTestResultSchema,
  WhatsAppTestSendRowSchema,
} from "../whatsapp-test-send.js";

describe("WhatsAppSendTestRequestSchema", () => {
  const base = {
    phoneNumberId: "1234567890",
    templateName: "hello_world",
    languageCode: "en_US",
    toNumber: "+15551234567",
  };

  it("accepts a well-formed request with E.164 toNumber", () => {
    expect(WhatsAppSendTestRequestSchema.parse(base)).toEqual(base);
  });

  it("rejects a non-E.164 toNumber (missing leading +)", () => {
    expect(() =>
      WhatsAppSendTestRequestSchema.parse({ ...base, toNumber: "15551234567" }),
    ).toThrow();
  });

  it("rejects an empty templateName", () => {
    expect(() => WhatsAppSendTestRequestSchema.parse({ ...base, templateName: "" })).toThrow();
  });
});

describe("WhatsAppSendTestResultSchema", () => {
  it("accepts status: 'sent' with a messageId", () => {
    const result = WhatsAppSendTestResultSchema.parse({
      messageId: "wamid.abc123",
      status: "sent",
      sentAt: "2026-05-15T12:34:56.000Z",
    });
    expect(result.status).toBe("sent");
    expect(result.messageId).toBe("wamid.abc123");
  });

  it("accepts status: 'failed' with an optional graphError", () => {
    const result = WhatsAppSendTestResultSchema.parse({
      messageId: null,
      status: "failed",
      sentAt: "2026-05-15T12:34:56.000Z",
      graphError: {
        code: "131026",
        message: "Message undeliverable",
        retryable: false,
      },
    });
    expect(result.status).toBe("failed");
    expect(result.graphError?.code).toBe("131026");
  });

  it("accepts status: 'failed' without a graphError (it is optional)", () => {
    const result = WhatsAppSendTestResultSchema.parse({
      messageId: null,
      status: "failed",
      sentAt: "2026-05-15T12:34:56.000Z",
    });
    expect(result.status).toBe("failed");
    expect(result.graphError).toBeUndefined();
  });
});

describe("WhatsAppTestSendRowSchema", () => {
  it("accepts a row with lastWebhookStatus: null and lastWebhookAt: null", () => {
    const row = WhatsAppTestSendRowSchema.parse({
      id: "row_1",
      messageId: "wamid.abc123",
      phoneNumberId: "1234567890",
      templateName: "hello_world",
      languageCode: "en_US",
      toNumber: "+15551234567",
      sentBy: "user_1",
      sentAt: "2026-05-15T12:34:56.000Z",
      apiStatus: "sent",
      lastWebhookStatus: null,
      lastWebhookAt: null,
    });
    expect(row.lastWebhookStatus).toBeNull();
    expect(row.lastWebhookAt).toBeNull();
  });
});
