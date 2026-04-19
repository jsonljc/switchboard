import { describe, it, expect } from "vitest";
import { isWithinWhatsAppWindow } from "../adapters/whatsapp.js";

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
