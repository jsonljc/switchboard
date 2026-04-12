import { describe, it, expect } from "vitest";
import {
  InteractionSummarySchema,
  DeploymentMemorySchema,
  DeploymentMemoryCategorySchema,
  InteractionOutcomeSchema,
  computeConfidenceScore,
} from "../deployment-memory.js";

describe("DeploymentMemoryCategorySchema", () => {
  it("accepts valid categories", () => {
    for (const cat of ["preference", "faq", "objection", "pattern", "fact"]) {
      expect(DeploymentMemoryCategorySchema.parse(cat)).toBe(cat);
    }
  });

  it("rejects invalid category", () => {
    expect(() => DeploymentMemoryCategorySchema.parse("invalid")).toThrow();
  });
});

describe("InteractionOutcomeSchema", () => {
  it("accepts valid outcomes", () => {
    for (const o of ["booked", "qualified", "lost", "info_request", "escalated"]) {
      expect(InteractionOutcomeSchema.parse(o)).toBe(o);
    }
  });
});

describe("InteractionSummarySchema", () => {
  it("parses a valid interaction summary", () => {
    const result = InteractionSummarySchema.parse({
      id: "sum-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      channelType: "telegram",
      summary: "Customer asked about teeth whitening pricing.",
      outcome: "info_request",
      duration: 120,
      messageCount: 8,
      createdAt: new Date(),
    });
    expect(result.organizationId).toBe("org-1");
    expect(result.extractedFacts).toEqual([]);
    expect(result.questionsAsked).toEqual([]);
  });
});

describe("DeploymentMemorySchema", () => {
  it("parses a valid deployment memory entry", () => {
    const result = DeploymentMemorySchema.parse({
      id: "mem-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "preference",
      content: "Prefers SMS over email for reminders",
      confidence: 0.7,
      sourceCount: 3,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.category).toBe("preference");
    expect(result.confidence).toBe(0.7);
  });

  it("applies default confidence and sourceCount", () => {
    const result = DeploymentMemorySchema.parse({
      id: "mem-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact",
      content: "Closed on Sundays",
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.confidence).toBe(0.5);
    expect(result.sourceCount).toBe(1);
  });
});

describe("computeConfidenceScore", () => {
  it("returns 0.5 for sourceCount=1", () => {
    expect(computeConfidenceScore(1, false)).toBeCloseTo(0.5, 2);
  });

  it("returns ~0.60 for sourceCount=2", () => {
    expect(computeConfidenceScore(2, false)).toBeCloseTo(0.6, 1);
  });

  it("returns ~0.66 for sourceCount=3", () => {
    expect(computeConfidenceScore(3, false)).toBeCloseTo(0.66, 1);
  });

  it("caps at 0.95 for high sourceCount", () => {
    expect(computeConfidenceScore(100, false)).toBe(0.95);
  });

  it("returns 1.0 when owner-confirmed", () => {
    expect(computeConfidenceScore(1, true)).toBe(1.0);
  });
});
