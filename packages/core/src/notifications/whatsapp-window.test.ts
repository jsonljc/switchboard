import { describe, it, expect } from "vitest";
import {
  WHATSAPP_WINDOW_MS,
  isWithinWhatsAppWindow,
  canSendWhatsAppTemplate,
} from "./whatsapp-window.js";

describe("whatsapp-window", () => {
  it("WHATSAPP_WINDOW_MS is 24h", () => {
    expect(WHATSAPP_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("null lastInboundAt is treated as OUTSIDE the window (fails closed)", () => {
    expect(isWithinWhatsAppWindow(null)).toBe(false);
  });

  it("a recent inbound is inside the window", () => {
    expect(isWithinWhatsAppWindow(new Date())).toBe(true);
  });

  it("inside the window any template is allowed", () => {
    expect(
      canSendWhatsAppTemplate({ contact: { messagingOptIn: false }, lastInboundAt: new Date() }),
    ).toEqual({ allowed: true });
  });

  it("outside the window requires opt-in", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    expect(
      canSendWhatsAppTemplate({ contact: { messagingOptIn: false }, lastInboundAt: old }),
    ).toEqual({ allowed: false, reason: "outside_window_no_consent" });
    expect(
      canSendWhatsAppTemplate({ contact: { messagingOptIn: true }, lastInboundAt: old }),
    ).toEqual({ allowed: true });
  });
});
