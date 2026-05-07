import { describe, it, expect } from "vitest";
import { canSendWhatsAppTemplate, isWithinWhatsAppWindow } from "../adapters/whatsapp.js";

describe("WhatsApp 24h compliance", () => {
  it("allows messages within 24h window", () => {
    const lastInbound = new Date(Date.now() - 12 * 60 * 60 * 1000);
    expect(isWithinWhatsAppWindow(lastInbound)).toBe(true);
  });

  it("rejects messages outside 24h window", () => {
    const lastInbound = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(isWithinWhatsAppWindow(lastInbound)).toBe(false);
  });

  it("rejects when no inbound timestamp exists", () => {
    expect(isWithinWhatsAppWindow(null)).toBe(false);
  });

  it("returns true at exactly 23h59m", () => {
    const justUnder = new Date(Date.now() - 23 * 60 * 60 * 1000 - 59 * 60 * 1000);
    expect(isWithinWhatsAppWindow(justUnder)).toBe(true);
  });
});

describe("canSendWhatsAppTemplate", () => {
  const insideWindow = new Date(Date.now() - 60 * 60 * 1000);
  const outsideWindow = new Date(Date.now() - 30 * 60 * 60 * 1000);

  it("allows inside 24h window regardless of opt-in (session is implicit consent)", () => {
    const result = canSendWhatsAppTemplate({
      contact: { messagingOptIn: false },
      lastInboundAt: insideWindow,
    });
    expect(result.allowed).toBe(true);
  });

  it("allows outside 24h window when contact has explicit messagingOptIn", () => {
    const result = canSendWhatsAppTemplate({
      contact: { messagingOptIn: true },
      lastInboundAt: outsideWindow,
    });
    expect(result.allowed).toBe(true);
  });

  it("denies outside 24h window when contact is not opted in", () => {
    const result = canSendWhatsAppTemplate({
      contact: { messagingOptIn: false },
      lastInboundAt: outsideWindow,
    });
    if (result.allowed) throw new Error("expected denial");
    expect(result.reason).toBe("outside_window_no_consent");
  });

  it("denies when no prior inbound and not opted in", () => {
    const result = canSendWhatsAppTemplate({
      contact: { messagingOptIn: false },
      lastInboundAt: null,
    });
    if (result.allowed) throw new Error("expected denial");
    expect(result.reason).toBe("outside_window_no_consent");
  });

  it("allows when no prior inbound but contact is opted in (e.g., web form)", () => {
    const result = canSendWhatsAppTemplate({
      contact: { messagingOptIn: true },
      lastInboundAt: null,
    });
    expect(result.allowed).toBe(true);
  });
});
