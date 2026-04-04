import { describe, it, expect } from "vitest";
import {
  AgentListingSchema,
  AgentDeploymentSchema,
  AgentTaskSchema,
  TrustScoreRecordSchema,
  AgentType,
  AutonomyLevel,
  PriceTier,
  AgentTaskStatus,
} from "../marketplace.js";

describe("Marketplace schemas", () => {
  describe("AgentListingSchema", () => {
    it("validates a complete listing", () => {
      const listing = {
        id: "lst_abc",
        name: "Email Outreach Agent",
        slug: "email-outreach",
        description: "Sends personalized cold emails",
        type: "switchboard_native" as const,
        status: "listed" as const,
        taskCategories: ["email", "outreach"],
        trustScore: 72.5,
        autonomyLevel: "guided" as const,
        priceTier: "pro" as const,
        priceMonthly: 299,
        webhookUrl: "https://agent.example.com/hook",
        webhookSecret: "whsec_xxx",
        vettingNotes: "Passed review 2026-04-01",
        sourceUrl: "https://github.com/example/agent",
        metadata: { version: "1.2.0" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = AgentListingSchema.safeParse(listing);
      expect(result.success).toBe(true);
    });

    it("applies defaults for optional fields", () => {
      const minimal = {
        id: "lst_abc",
        name: "Test Agent",
        slug: "test-agent",
        description: "A test",
        type: "switchboard_native" as const,
        status: "pending_review" as const,
        taskCategories: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = AgentListingSchema.parse(minimal);
      expect(result.trustScore).toBe(50);
      expect(result.autonomyLevel).toBe("supervised");
      expect(result.priceTier).toBe("free");
      expect(result.priceMonthly).toBe(0);
    });
  });

  describe("AgentDeploymentSchema", () => {
    it("validates a deployment", () => {
      const deployment = {
        id: "dep_abc",
        organizationId: "org_123",
        listingId: "lst_abc",
        status: "active" as const,
        inputConfig: { targetAudience: "SaaS founders" },
        governanceSettings: { maxSpendPerDay: 100 },
        outputDestination: { type: "webhook", url: "https://example.com" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = AgentDeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(true);
    });
  });

  describe("AgentTaskSchema", () => {
    it("validates a task", () => {
      const task = {
        id: "tsk_abc",
        deploymentId: "dep_abc",
        organizationId: "org_123",
        listingId: "lst_abc",
        category: "email",
        status: "pending" as const,
        input: { subject: "Hello" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = AgentTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });
  });

  describe("TrustScoreRecordSchema", () => {
    it("validates a trust score record", () => {
      const record = {
        id: "tsr_abc",
        listingId: "lst_abc",
        taskCategory: "email",
        score: 72.5,
        totalApprovals: 45,
        totalRejections: 3,
        consecutiveApprovals: 12,
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = TrustScoreRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });
  });

  describe("Enum values", () => {
    it("exports correct enum values", () => {
      expect(AgentType.options).toEqual(["open_source", "third_party", "switchboard_native"]);
      expect(AutonomyLevel.options).toEqual(["supervised", "guided", "autonomous"]);
      expect(PriceTier.options).toEqual(["free", "basic", "pro", "elite"]);
      expect(AgentTaskStatus.options).toEqual([
        "pending",
        "running",
        "completed",
        "awaiting_review",
        "approved",
        "rejected",
        "failed",
        "cancelled",
      ]);
    });
  });
});
