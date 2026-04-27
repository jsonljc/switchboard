import { describe, it, expect, vi } from "vitest";
import { resolveContactIdentity } from "../resolve-contact-identity.js";
import type { GatewayContactStore } from "../types.js";

function makeStore(overrides: Partial<GatewayContactStore> = {}): GatewayContactStore {
  return {
    findByPhone: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "new-contact-id" }),
    ...overrides,
  };
}

describe("resolveContactIdentity", () => {
  it("WhatsApp + new phone: creates Contact once and returns its id", async () => {
    const store = makeStore();
    const result = await resolveContactIdentity({
      channel: "whatsapp",
      sessionId: "+6599999999",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).toHaveBeenCalledWith("org-1", "+6599999999");
    expect(store.create).toHaveBeenCalledWith({
      organizationId: "org-1",
      phone: "+6599999999",
      primaryChannel: "whatsapp",
      source: "whatsapp_inbound",
    });
    expect(result).toEqual({
      contactId: "new-contact-id",
      phone: "+6599999999",
      channel: "whatsapp",
    });
  });

  it("WhatsApp + existing phone: returns existing id without creating", async () => {
    const store = makeStore({
      findByPhone: vi.fn().mockResolvedValue({ id: "existing-contact-id" }),
    });
    const result = await resolveContactIdentity({
      channel: "whatsapp",
      sessionId: "+6599999999",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      contactId: "existing-contact-id",
      phone: "+6599999999",
      channel: "whatsapp",
    });
  });

  it("telegram: returns null identity without touching the store", async () => {
    const store = makeStore();
    const result = await resolveContactIdentity({
      channel: "telegram",
      sessionId: "tg-12345",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      contactId: null,
      phone: null,
      channel: "telegram",
    });
  });

  it("dashboard: returns null identity without touching the store", async () => {
    const store = makeStore();
    const result = await resolveContactIdentity({
      channel: "dashboard",
      sessionId: "session-abc",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      contactId: null,
      phone: null,
      channel: "dashboard",
    });
  });

  it("widget: returns null identity without touching the store", async () => {
    const store = makeStore();
    const result = await resolveContactIdentity({
      channel: "widget",
      sessionId: "widget-xyz",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      contactId: null,
      phone: null,
      channel: "widget",
    });
  });
});
