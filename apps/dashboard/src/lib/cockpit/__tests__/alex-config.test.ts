// apps/dashboard/src/lib/cockpit/__tests__/alex-config.test.ts
import { describe, it, expect } from "vitest";
import { ALEX_CONFIG, statusColor, statusPulse, animState } from "../alex-config";

describe("alex-config", () => {
  it("uses coral identity accent via the canonical --agent-alex tokens (T2)", () => {
    expect(ALEX_CONFIG.accent.base).toBe("hsl(var(--agent-alex))");
    expect(ALEX_CONFIG.accent.deep).toBe("hsl(var(--agent-alex-deep))");
  });

  it("statusColor returns destructive when halted regardless of key", () => {
    expect(statusColor("WORKING", true)).toBe("hsl(var(--destructive))");
    expect(statusColor("WAITING", true)).toBe("hsl(var(--destructive))");
  });

  it("statusColor: positive for WORKING, action for WAITING, ink-4 for IDLE", () => {
    expect(statusColor("WORKING", false)).toBe("hsl(var(--positive))");
    expect(statusColor("WAITING", false)).toBe("hsl(var(--action))");
    expect(statusColor("IDLE", false)).toBe("var(--ink-4)");
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
