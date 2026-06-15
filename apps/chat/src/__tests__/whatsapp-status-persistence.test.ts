import { describe, it, expect, vi } from "vitest";
import { makeWhatsAppStatusHandler } from "../bridges/whatsapp-status-persistence.js";

const baseStatus = {
  messageId: "wamid.ABC",
  recipientId: "+15551230000",
  status: "delivered",
  timestamp: new Date(0),
};

describe("makeWhatsAppStatusHandler", () => {
  it("persists the status to the store with the org id, then calls next", async () => {
    const upsert = vi.fn(async () => ({}));
    const next = vi.fn(async () => {});
    const handler = makeWhatsAppStatusHandler({ statusStore: { upsert }, next });

    await handler(baseStatus, "org_9");

    expect(upsert).toHaveBeenCalledWith({ ...baseStatus, organizationId: "org_9" });
    expect(next).toHaveBeenCalledWith(baseStatus, "org_9");
  });

  it("persists real-conversation status even with no orgId (audit #6: these were dropped)", async () => {
    const upsert = vi.fn(async () => ({}));
    const handler = makeWhatsAppStatusHandler({ statusStore: { upsert } });

    await handler(baseStatus, undefined);

    expect(upsert).toHaveBeenCalledWith({ ...baseStatus, organizationId: undefined });
  });

  it("still calls next when the store upsert throws (persistence is best-effort)", async () => {
    const upsert = vi.fn(async () => {
      throw new Error("db down");
    });
    const next = vi.fn(async () => {});
    const handler = makeWhatsAppStatusHandler({ statusStore: { upsert }, next });

    await expect(handler(baseStatus, "org_1")).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledWith(baseStatus, "org_1");
  });

  it("works with no store (only next runs)", async () => {
    const next = vi.fn(async () => {});
    const handler = makeWhatsAppStatusHandler({ statusStore: null, next });

    await handler(baseStatus, "org_2");

    expect(next).toHaveBeenCalledWith(baseStatus, "org_2");
  });
});
