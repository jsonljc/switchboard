import { describe, it, expect } from "vitest";
import {
  AgentListingSchema,
  AgentDeploymentSchema,
  AgentTaskSchema,
  TrustScoreRecordSchema,
  AgentType,
  AgentFamily,
  AutonomyLevel,
  PriceTier,
  AgentTaskStatus,
  AgentActionRequestSchema,
  DeploymentStateSchema,
  DeploymentConnectionSchema,
  AgentActionType,
  AgentActionStatus,
  ConnectionStatus,
  ScannedBusinessProfileSchema,
  OnboardingConfigSchema,
  SetupSchema,
  SetupFieldSchema,
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
      expect(result.trustScore).toBe(0);
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

  describe("AgentFamily", () => {
    it("accepts valid family values", () => {
      expect(AgentFamily.parse("sales_pipeline")).toBe("sales_pipeline");
      expect(AgentFamily.parse("paid_media")).toBe("paid_media");
      expect(AgentFamily.parse("organic_growth")).toBe("organic_growth");
      expect(AgentFamily.parse("customer_experience")).toBe("customer_experience");
    });
    it("rejects invalid family", () => {
      expect(() => AgentFamily.parse("invalid")).toThrow();
    });
  });

  describe("AgentActionRequestSchema", () => {
    it("parses a valid action request", () => {
      const result = AgentActionRequestSchema.safeParse({
        id: "ar_1",
        deploymentId: "dep_1",
        type: "send_message",
        surface: "telegram",
        payload: { content: "Hello" },
        status: "pending",
        createdAt: new Date(),
      });
      expect(result.success).toBe(true);
    });

    it("defaults status to pending", () => {
      const result = AgentActionRequestSchema.safeParse({
        id: "ar_1",
        deploymentId: "dep_1",
        type: "send_message",
        surface: "telegram",
        payload: {},
        createdAt: new Date(),
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("pending");
    });
  });

  describe("DeploymentStateSchema", () => {
    it("parses valid state entry", () => {
      const result = DeploymentStateSchema.safeParse({
        id: "st_1",
        deploymentId: "dep_1",
        key: "leads:count",
        value: 42,
        updatedAt: new Date(),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("DeploymentConnectionSchema", () => {
    it("parses valid connection", () => {
      const result = DeploymentConnectionSchema.safeParse({
        id: "conn_1",
        deploymentId: "dep_1",
        type: "telegram",
        slot: "default",
        status: "active",
        credentials: "encrypted-token",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(result.success).toBe(true);
    });

    it("defaults slot to default", () => {
      const result = DeploymentConnectionSchema.safeParse({
        id: "conn_1",
        deploymentId: "dep_1",
        type: "telegram",
        status: "active",
        credentials: "encrypted-token",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.slot).toBe("default");
    });
  });

  describe("AgentActionType enum", () => {
    it("has expected values", () => {
      expect(AgentActionType.options).toEqual([
        "send_message",
        "browse_url",
        "read_file",
        "write_file",
        "api_call",
      ]);
    });
  });

  describe("AgentActionStatus enum", () => {
    it("has expected values", () => {
      expect(AgentActionStatus.options).toEqual([
        "pending",
        "approved",
        "rejected",
        "executed",
        "blocked",
      ]);
    });
  });

  describe("ConnectionStatus enum", () => {
    it("has expected values", () => {
      expect(ConnectionStatus.options).toEqual(["active", "expired", "revoked"]);
    });
  });

  describe("OnboardingConfigSchema", () => {
    it("applies defaults when fields are omitted", () => {
      const result = OnboardingConfigSchema.parse({});
      expect(result.websiteScan).toBe(true);
      expect(result.publicChannels).toBe(false);
      expect(result.privateChannel).toBe(false);
      expect(result.integrations).toEqual([]);
    });

    it("accepts explicit values", () => {
      const result = OnboardingConfigSchema.parse({
        websiteScan: false,
        publicChannels: true,
        integrations: ["xero"],
      });
      expect(result.websiteScan).toBe(false);
      expect(result.publicChannels).toBe(true);
      expect(result.integrations).toEqual(["xero"]);
    });
  });

  describe("SetupSchema", () => {
    it("validates a complete setup schema", () => {
      const schema = {
        onboarding: { websiteScan: true, publicChannels: true },
        steps: [
          {
            id: "basics",
            title: "Basic Setup",
            fields: [
              {
                key: "tone",
                type: "select",
                label: "Tone",
                required: true,
                options: ["friendly", "professional"],
              },
              {
                key: "bookingLink",
                type: "url",
                label: "Booking Link",
                required: false,
                prefillFrom: "scannedProfile.website",
              },
            ],
          },
        ],
      };
      const result = SetupSchema.parse(schema);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]?.fields).toHaveLength(2);
      expect(result.onboarding?.publicChannels).toBe(true);
    });

    it("rejects invalid field type", () => {
      expect(() =>
        SetupFieldSchema.parse({ key: "x", type: "invalid", label: "X", required: true }),
      ).toThrow();
    });
  });

  describe("ScannedBusinessProfileSchema", () => {
    it("validates a complete business profile", () => {
      const profile = {
        businessName: "Austin Bakery",
        description: "Family-owned bakery since 1985",
        products: [{ name: "Sourdough Bread", description: "Fresh daily", price: "$8" }],
        services: ["Custom cakes", "Catering"],
        location: { address: "123 Main St", city: "Austin", state: "TX" },
        hours: { monday: "7am-5pm", tuesday: "7am-5pm" },
        phone: "(512) 555-0100",
        email: "hello@austinbakery.com",
        faqs: [{ question: "Do you deliver?", answer: "Yes, within 10 miles" }],
        brandLanguage: ["artisan", "family", "handcrafted"],
        platformDetected: "shopify",
      };
      const result = ScannedBusinessProfileSchema.parse(profile);
      expect(result.businessName).toBe("Austin Bakery");
      expect(result.products).toHaveLength(1);
      expect(result.platformDetected).toBe("shopify");
    });

    it("validates a minimal business profile (optional fields omitted)", () => {
      const minimal = {
        businessName: "Test Biz",
        description: "A business",
        products: [],
        services: [],
        faqs: [],
        brandLanguage: [],
      };
      const result = ScannedBusinessProfileSchema.parse(minimal);
      expect(result.businessName).toBe("Test Biz");
      expect(result.location).toBeUndefined();
      expect(result.platformDetected).toBeUndefined();
    });

    it("rejects invalid platformDetected value", () => {
      expect(() =>
        ScannedBusinessProfileSchema.parse({
          businessName: "Test",
          description: "Test",
          products: [],
          services: [],
          faqs: [],
          brandLanguage: [],
          platformDetected: "invalid-platform",
        }),
      ).toThrow();
    });
  });
});
