import { describe, it, expect } from "vitest";
import {
  RILEY_ACCENT,
  RILEY_MISSION_SUBTITLE,
  statusColor,
  statusPulse,
  RILEY_COMPOSER_PLACEHOLDER,
  RILEY_COMMANDS,
} from "../riley-config";

describe("riley-config", () => {
  it("RILEY_ACCENT carries teal identity tokens (moved off amber in P0-B)", () => {
    expect(RILEY_ACCENT).toEqual({
      base: "hsl(var(--agent-riley))",
      deep: "hsl(var(--agent-riley-deep))",
      soft: "hsl(var(--agent-riley) / 0.30)",
      paper: "hsl(var(--agent-riley-tint))",
    });
  });

  it("RILEY_MISSION_SUBTITLE is a plain string in B.1 (popover deferred to B.2)", () => {
    expect(typeof RILEY_MISSION_SUBTITLE).toBe("string");
    expect(RILEY_MISSION_SUBTITLE.length).toBeGreaterThan(0);
  });

  it("statusColor maps WATCHING→positive, WAITING→action, IDLE→ink-4, HALTED→destructive", () => {
    expect(statusColor("WATCHING", false)).toBe("hsl(var(--positive))");
    expect(statusColor("WAITING", false)).toBe("hsl(var(--action))");
    expect(statusColor("IDLE", false)).toBe("var(--ink-4)");
    expect(statusColor("HALTED", false)).toBe("hsl(var(--destructive))");
  });

  it("statusColor returns destructive when halted=true regardless of statusKey", () => {
    expect(statusColor("WATCHING", true)).toBe("hsl(var(--destructive))");
    expect(statusColor("WAITING", true)).toBe("hsl(var(--destructive))");
    expect(statusColor("IDLE", true)).toBe("hsl(var(--destructive))");
    expect(statusColor("REVIEWING", true)).toBe("hsl(var(--destructive))");
  });

  it("statusPulse does NOT pulse on WAITING in B.1 (REVIEWING is the only pulse case; deferred)", () => {
    expect(statusPulse("WAITING", false)).toBe(false);
    expect(statusPulse("WATCHING", false)).toBe(false);
    expect(statusPulse("IDLE", false)).toBe(false);
    expect(statusPulse("HALTED", false)).toBe(false);
    expect(statusPulse("REVIEWING", false)).toBe(true);
  });

  it("statusPulse never pulses when halted=true (even on REVIEWING)", () => {
    expect(statusPulse("REVIEWING", true)).toBe(false);
    expect(statusPulse("WATCHING", true)).toBe(false);
    expect(statusPulse("WAITING", true)).toBe(false);
  });

  it("RILEY_COMPOSER_PLACEHOLDER carries the locked Riley voice placeholder", () => {
    expect(RILEY_COMPOSER_PLACEHOLDER).toBe(
      "Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…",
    );
  });

  it("RILEY_COMMANDS exports the locked Riley command catalog grouped into control / thread / rules / nav", () => {
    const ids = RILEY_COMMANDS.map((c) => c.id);
    expect(ids).toEqual([
      "open-meta",
      "open-rules",
      "open-targets",
      "pause-1h",
      "resume",
      "brief-eod",
      "cpl-30",
    ]);
    const groups = new Set(RILEY_COMMANDS.map((c) => c.group));
    expect([...groups].sort()).toEqual(["control", "nav", "rules", "thread"]);
    RILEY_COMMANDS.forEach((c) => {
      expect(c.label.length).toBeGreaterThan(2);
      expect(["control", "thread", "rules", "nav"]).toContain(c.group);
    });
  });
});
