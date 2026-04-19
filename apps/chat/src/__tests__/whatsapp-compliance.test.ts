import { describe, it, expect } from "vitest";
import { isWithinWhatsAppWindow } from "../adapters/whatsapp.js";

// ── Opt-out keyword detection ─────────────────────────────────────────────
// ChatRuntime was deleted (P0 convergence sprint, Task 8).
// Task 9 will rewrite these tests against ChannelGateway + PlatformIngress.
describe.skip("WhatsApp opt-out compliance (pending Task 9 rewrite)", () => {
  it("placeholder — see Task 9", () => {
    expect(true).toBe(true);
  });
});

// ── 24-hour conversation window ───────────────────────────────────────────

describe("WhatsApp 24h conversation window", () => {
  it("returns true when last inbound is within 24 hours", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(isWithinWhatsAppWindow(oneHourAgo)).toBe(true);
  });

  it("returns false when last inbound is older than 24 hours", () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(isWithinWhatsAppWindow(twentyFiveHoursAgo)).toBe(false);
  });

  it("returns false when lastInboundAt is null", () => {
    expect(isWithinWhatsAppWindow(null)).toBe(false);
  });

  it("returns true at exactly 23h59m", () => {
    const justUnder = new Date(Date.now() - 23 * 60 * 60 * 1000 - 59 * 60 * 1000);
    expect(isWithinWhatsAppWindow(justUnder)).toBe(true);
  });
});
