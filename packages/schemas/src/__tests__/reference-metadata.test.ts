import { describe, it, expect } from "vitest";
import { ReferenceMetadataSchema } from "../reference-metadata.js";

describe("ReferenceMetadataSchema", () => {
  it("validates a minimal regulatory reference", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "critical",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(true);
  });

  it("validates a voice reference with both jurisdictions", () => {
    const meta = {
      jurisdiction: "both",
      vertical: "medspa",
      clinicType: "both",
      appliesTo: "voice",
      riskLevel: "low",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
      sources: ["https://example.com/guide"],
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(true);
  });

  it("rejects unknown jurisdiction", () => {
    const meta = {
      jurisdiction: "US",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "high",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("rejects invalid riskLevel", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "extreme",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("rejects calendar-invalid lastReviewedAt", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "high",
      lastReviewedAt: "2026-13-99",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("rejects empty owner string", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "high",
      lastReviewedAt: "2026-05-10",
      owner: "",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("rejects non-URL entries in sources", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "high",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
      sources: ["not-a-url"],
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("accepts vertical=none and clinicType=none for cross-cutting references", () => {
    // Channel/platform references that don't meaningfully map to a clinic
    // type or vertical (e.g., a generic platform-policy doc) need this
    // escape hatch.
    const meta = {
      jurisdiction: "both",
      vertical: "none",
      clinicType: "none",
      appliesTo: "channel",
      riskLevel: "low",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(true);
  });
});
