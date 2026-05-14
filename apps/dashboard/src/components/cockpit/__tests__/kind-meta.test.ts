// apps/dashboard/src/components/cockpit/__tests__/kind-meta.test.ts
import { describe, it, expect } from "vitest";
import { KIND_META, lookupKindMeta } from "../kind-meta.js";

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

  it("does NOT include Riley kinds at A.1 (Riley PR adds them)", () => {
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
      expect(keys).not.toContain(k);
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

  it("lookupKindMeta returns the Alex entry for a known kind", () => {
    expect(lookupKindMeta("booked")).toMatchObject({ label: "BOOKED" });
  });

  it("lookupKindMeta falls back to a neutral entry for an unmapped kind", () => {
    expect(lookupKindMeta("watching")).toMatchObject({ label: "WATCHING" });
  });
});
