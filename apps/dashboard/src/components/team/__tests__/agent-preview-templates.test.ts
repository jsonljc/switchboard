import { describe, it, expect } from "vitest";
import { getPreviewMessage } from "../agent-preview-templates";

describe("getPreviewMessage", () => {
  it("generates warm greeting for responder", () => {
    const msg = getPreviewMessage("responder", "warm-professional", {}, "Acme Clinic");
    expect(msg).toContain("Acme Clinic");
    expect(msg).toContain("Welcome");
  });

  it("generates casual greeting for responder", () => {
    const msg = getPreviewMessage("responder", "casual-conversational", {}, "Acme Clinic");
    expect(msg).toContain("Hey");
  });

  it("generates direct greeting for responder", () => {
    const msg = getPreviewMessage("responder", "direct-efficient", {}, "Acme Clinic");
    expect(msg).toContain("Hello");
  });

  it("includes qualification depth for responder with deep config", () => {
    const msg = getPreviewMessage(
      "responder",
      "warm-professional",
      { qualificationThreshold: 60 },
      "Acme",
    );
    expect(msg).toContain("budget");
  });

  it("includes follow-up timing for strategist", () => {
    const msg = getPreviewMessage(
      "strategist",
      "casual-conversational",
      { followUpDays: [1, 2, 4] },
      "Acme",
    );
    expect(msg).toContain("tomorrow");
  });

  it("includes threshold for optimizer", () => {
    const msg = getPreviewMessage(
      "optimizer",
      "warm-professional",
      { approvalThreshold: 200 },
      "Acme",
    );
    expect(msg).toContain("$200");
  });

  it("generates tone-only greeting for booker", () => {
    const msg = getPreviewMessage("booker", "warm-professional", {}, "Acme");
    expect(msg).toBeTruthy();
  });

  it("uses fallback business name when empty", () => {
    const msg = getPreviewMessage("responder", "warm-professional", {}, "");
    expect(msg).toContain("your business");
  });

  it("handles onboarding agent IDs (lead-responder -> responder)", () => {
    const msg = getPreviewMessage("lead-responder", "warm-professional", {}, "Acme");
    expect(msg).toContain("Acme");
    expect(msg).toContain("Welcome");
  });

  it("handles onboarding agent IDs (sales-closer -> strategist)", () => {
    const msg = getPreviewMessage(
      "sales-closer",
      "casual-conversational",
      { followUpDays: [1, 3, 7] },
      "Acme",
    );
    expect(msg).toContain("checking in");
  });
});
