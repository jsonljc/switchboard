import { describe, it, expect } from "vitest";
import { RILEY_KIND_META } from "../kind-meta-riley";

const RILEY_KINDS = [
  "watching",
  "reviewing",
  "paused",
  "scaled",
  "rotated",
  "shifted",
  "restructured",
  "started",
  "alert",
] as const;

describe("RILEY_KIND_META", () => {
  it("includes all 9 Riley activity kinds", () => {
    for (const k of RILEY_KINDS) {
      expect(RILEY_KIND_META).toHaveProperty(k);
    }
  });

  it("each kind entry has { label, color, pulse }", () => {
    for (const k of RILEY_KINDS) {
      const entry = RILEY_KIND_META[k];
      expect(entry).toHaveProperty("label");
      expect(entry).toHaveProperty("color");
      expect(entry).toHaveProperty("pulse");
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.color).toBe("string");
      expect(typeof entry.pulse).toBe("boolean");
    }
  });

  it("reviewing pulses; others do not", () => {
    expect(RILEY_KIND_META.reviewing.pulse).toBe(true);
    expect(RILEY_KIND_META.watching.pulse).toBe(false);
    expect(RILEY_KIND_META.paused.pulse).toBe(false);
    expect(RILEY_KIND_META.alert.pulse).toBe(false);
  });

  it("labels are uppercase per the spec", () => {
    expect(RILEY_KIND_META.watching.label).toBe("WATCHING");
    expect(RILEY_KIND_META.scaled.label).toBe("SCALED");
    expect(RILEY_KIND_META.alert.label).toBe("ALERT");
  });

  it("alert is red; watching/scaled are green; paused/started are ink3", () => {
    expect(RILEY_KIND_META.alert.color).toBe("#A03A2E");
    expect(RILEY_KIND_META.watching.color).toBe("#3F7A36");
    expect(RILEY_KIND_META.scaled.color).toBe("#3F7A36");
    expect(RILEY_KIND_META.paused.color).toBe("#6B6052");
    expect(RILEY_KIND_META.started.color).toBe("#6B6052");
  });
});
