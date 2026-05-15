import { describe, it, expect } from "vitest";
import {
  RILEY_ACCENT,
  RILEY_TABS,
  RILEY_MISSION_SUBTITLE,
  statusColor,
  statusPulse,
  RILEY_COMPOSER_PLACEHOLDER,
  RILEY_COMMANDS,
} from "../riley-config";

describe("riley-config", () => {
  it("RILEY_ACCENT carries the four warm-clay tokens from the Riley target spec", () => {
    expect(RILEY_ACCENT).toEqual({
      base: "#B86C50",
      deep: "#7E4533",
      soft: "#ECD4C8",
      paper: "#F6E7DE",
    });
  });

  it("RILEY_TABS orders Alex / Riley / Mira with Riley active (TopbarTab shape)", () => {
    expect(RILEY_TABS).toEqual([
      { name: "Alex" },
      { name: "Riley", active: true },
      { name: "Mira", muted: true },
    ]);
  });

  it("RILEY_MISSION_SUBTITLE is a plain string in B.1 (popover deferred to B.2)", () => {
    expect(typeof RILEY_MISSION_SUBTITLE).toBe("string");
    expect(RILEY_MISSION_SUBTITLE.length).toBeGreaterThan(0);
  });

  it("statusColor maps WATCHING to green, WAITING to amber, IDLE to grey, HALTED to red", () => {
    expect(statusColor("WATCHING")).toBe("#3F7A36");
    expect(statusColor("WAITING")).toBe("#B8782E");
    expect(statusColor("IDLE")).toBe("#A39786");
    expect(statusColor("HALTED")).toBe("#A03A2E");
  });

  it("statusPulse does NOT pulse on WAITING in B.1 (REVIEWING is the only pulse case; deferred)", () => {
    expect(statusPulse("WAITING")).toBe(false);
    expect(statusPulse("WATCHING")).toBe(false);
    expect(statusPulse("IDLE")).toBe(false);
    expect(statusPulse("HALTED")).toBe(false);
    expect(statusPulse("REVIEWING")).toBe(true);
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
