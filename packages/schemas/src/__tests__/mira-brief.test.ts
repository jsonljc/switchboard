import { describe, it, expect } from "vitest";
import {
  MiraBriefRequestSchema,
  mapMiraBriefToCreativeBrief,
  classifyBriefIntent,
} from "../mira-brief.js";

describe("MiraBriefRequestSchema", () => {
  it("requires a non-empty `promoting` line; goal/vibe default", () => {
    const parsed = MiraBriefRequestSchema.parse({ promoting: "Summer Botox special" });
    expect(parsed.goal).toBe("more_bookings");
    expect(parsed.vibe).toBe("warm");
    expect(MiraBriefRequestSchema.safeParse({ promoting: "" }).success).toBe(false);
    expect(MiraBriefRequestSchema.safeParse({ promoting: "x", goal: "nope" }).success).toBe(false);
  });
});

describe("mapMiraBriefToCreativeBrief", () => {
  it("composes promoting + goal objective, maps vibe → brandVoice, medspa-safe defaults", () => {
    const brief = mapMiraBriefToCreativeBrief({
      promoting: "Summer Botox special",
      goal: "more_bookings",
      vibe: "warm",
    });
    expect(brief.productDescription).toBe("Summer Botox special — drive bookings");
    expect(brief.brandVoice).toMatch(/warm/i);
    expect(brief.targetAudience).toMatch(/aesthetic|prospect/i);
    expect(brief.platforms).toEqual(["meta"]);
    expect(brief.references).toEqual([]); // reference/asset upload is deferred in Phase 2
  });
});

describe("classifyBriefIntent (off-scope redirect)", () => {
  it("flags scheduling/results questions as off_scope (never to be answered)", () => {
    expect(classifyBriefIntent("When can I rebook my 3pm client?")).toBe("off_scope");
    expect(classifyBriefIntent("How much revenue did last month's ad make?")).toBe("off_scope");
    expect(classifyBriefIntent("What were the results of my campaign?")).toBe("off_scope");
  });

  it("treats a real creative brief as creative", () => {
    expect(classifyBriefIntent("Summer Botox special — $11/unit through July")).toBe("creative");
    expect(classifyBriefIntent("Promote our new lip filler treatment")).toBe("creative");
  });

  it("does NOT misclassify common booking/appointment CTAs as off_scope (no question shape)", () => {
    // These mention scheduling words but are ordinary creative briefs, not questions.
    expect(classifyBriefIntent("Book now — Botox from $11/unit")).toBe("creative");
    expect(classifyBriefIntent("Promote our new online booking")).toBe("creative");
    expect(classifyBriefIntent("New appointment slots available — drive new clients")).toBe(
      "creative",
    );
    expect(classifyBriefIntent("Lead-gen campaign for our facial package")).toBe("creative");
  });
});
