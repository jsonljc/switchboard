// apps/dashboard/src/lib/cockpit/__tests__/alex-config.test.ts
import { describe, it, expect } from "vitest";
import { ALEX_CONFIG, statusColor, statusPulse, animState } from "../alex-config.js";

describe("alex-config", () => {
  it("uses warm amber accent", () => {
    expect(ALEX_CONFIG.accent.base).toBe("#B8782E");
    expect(ALEX_CONFIG.accent.deep).toBe("#7C4F1C");
  });

  it("exposes Alex/Riley/Mira tabs with Alex active and Mira muted", () => {
    expect(ALEX_CONFIG.tabs).toEqual([
      { name: "Alex", active: true },
      { name: "Riley" },
      { name: "Mira", muted: true },
    ]);
  });

  it("statusColor returns red when halted regardless of key", () => {
    expect(statusColor("WORKING", true)).toBe("#A03A2E");
    expect(statusColor("WAITING", true)).toBe("#A03A2E");
  });

  it("statusColor returns green for WORKING, amber for WAITING, grey for IDLE", () => {
    expect(statusColor("WORKING", false)).toBe("#3F7A36");
    expect(statusColor("WAITING", false)).toBe("#B8782E");
    expect(statusColor("IDLE", false)).toBe("#A39786");
  });

  it("statusPulse pulses only on WORKING/WAITING and never when halted", () => {
    expect(statusPulse("WORKING", false)).toBe(true);
    expect(statusPulse("WAITING", false)).toBe(true);
    expect(statusPulse("IDLE", false)).toBe(false);
    expect(statusPulse("WORKING", true)).toBe(false);
  });

  it("animState returns 'sleep' when halted, 'draft' when working/waiting, 'idle' otherwise", () => {
    expect(animState("WORKING", true)).toBe("sleep");
    expect(animState("WORKING", false)).toBe("draft");
    expect(animState("WAITING", false)).toBe("draft");
    expect(animState("IDLE", false)).toBe("idle");
  });
});
