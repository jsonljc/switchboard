// apps/dashboard/src/components/cockpit/__tests__/kind-meta.test.ts
import { describe, it, expect } from "vitest";
import { KIND_META, lookupKindMeta } from "../kind-meta";
import type { ActivityKind } from "../types";

describe("KIND_META", () => {
  it("includes all 9 Alex activity kinds", () => {
    const keys = Object.keys(KIND_META);
    for (const k of [
      "booked",
      "qualified",
      "replied",
      "sent",
      "started",
      "connected",
      "waiting",
      "escalated",
      "passed",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("includes all 8 Riley-specific activity kinds (B.1 wired them)", () => {
    const keys = Object.keys(KIND_META);
    for (const k of [
      "watching",
      "reviewing",
      "paused",
      "scaled",
      "rotated",
      "shifted",
      "restructured",
      "alert",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("`booked` uses amberDeep + amberSoft background", () => {
    expect(KIND_META.booked).toMatchObject({ label: "BOOKED", color: "#7C4F1C", bg: "#F1E2C2" });
  });

  it("`escalated` uses red", () => {
    expect(KIND_META.escalated).toMatchObject({ label: "TO YOU", color: "#A03A2E" });
  });

  it("`waiting` carries an amberDeep color with amberSoft background", () => {
    expect(KIND_META.waiting).toMatchObject({ label: "WAITING", color: "#7C4F1C", bg: "#F1E2C2" });
  });

  it("Riley `alert` uses red; `reviewing` pulses", () => {
    expect(KIND_META.alert).toMatchObject({ label: "ALERT", color: "#A03A2E" });
    expect(KIND_META.reviewing).toMatchObject({ label: "REVIEWING", pulse: true });
  });

  it("Riley `watching` and `scaled` share the green palette", () => {
    expect(KIND_META.watching).toMatchObject({ label: "WATCHING", color: "#3F7A36" });
    expect(KIND_META.scaled).toMatchObject({ label: "SCALED", color: "#3F7A36" });
  });

  it("lookupKindMeta returns the Alex entry for a known kind", () => {
    expect(lookupKindMeta("booked")).toMatchObject({ label: "BOOKED" });
  });

  it("lookupKindMeta returns the Riley entry for a Riley kind", () => {
    expect(lookupKindMeta("watching")).toMatchObject({ label: "WATCHING", color: "#3F7A36" });
  });

  it("lookupKindMeta falls back to a neutral entry for an unmapped kind", () => {
    // Force an ActivityKind value that no entry maps. Cast for the negative case.
    const result = lookupKindMeta("__unknown__" as ActivityKind);
    expect(result.label).toBe("__UNKNOWN__");
    expect(result.color).toBe("#6B6052");
  });
});
