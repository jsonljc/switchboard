// ---------------------------------------------------------------------------
// Tests: Cartridge (integration)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { bootstrapCustomerEngagementCartridge } from "../cartridge/bootstrap.js";
import { CUSTOMER_ENGAGEMENT_MANIFEST } from "../cartridge/manifest.js";

describe("CustomerEngagementCartridge", () => {
  it("should have correct manifest", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    expect(cartridge.manifest.id).toBe("customer-engagement");
    expect(cartridge.manifest.actions.length).toBe(16);
  });

  it("should initialize without error", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    await expect(
      cartridge.initialize({
        principalId: "test",
        organizationId: null,
        connectionCredentials: {},
      }),
    ).resolves.not.toThrow();
  });

  it("should return guardrails", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const guardrails = cartridge.getGuardrails();
    expect(guardrails.rateLimits.length).toBeGreaterThan(0);
    expect(guardrails.cooldowns.length).toBeGreaterThan(0);
  });

  it("should return risk input", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const risk = await cartridge.getRiskInput("customer-engagement.lead.score", {}, {});
    expect(risk.baseRisk).toBe("none");
  });

  it("should return high risk for review responses", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const risk = await cartridge.getRiskInput("customer-engagement.review.respond", {}, {});
    expect(risk.baseRisk).toBe("high");
  });

  it("should execute lead scoring", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const result = await cartridge.execute(
      "customer-engagement.lead.score",
      {
        contactId: "p-1",
        serviceValue: 500,
        urgencyLevel: 7,
        source: "referral",
      },
      { principalId: "test", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("should execute LTV scoring", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const result = await cartridge.execute(
      "customer-engagement.contact.score_ltv",
      {
        contactId: "p-1",
        averageServiceValue: 500,
        visitFrequency: 2,
        retentionYears: 3,
      },
      { principalId: "test", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("should execute appointment booking", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const result = await cartridge.execute(
      "customer-engagement.appointment.book",
      {
        contactId: "p-1",
        startTime: new Date().toISOString(),
        serviceType: "consultation",
      },
      { principalId: "test", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.undoRecipe).not.toBeNull();
  });

  it("should execute pipeline diagnosis", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const result = await cartridge.execute(
      "customer-engagement.pipeline.diagnose",
      { organizationId: "org-1", businessType: "general" },
      { principalId: "test", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("should execute escalation", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const result = await cartridge.execute(
      "customer-engagement.conversation.escalate",
      { contactId: "p-1", reason: "Patient upset" },
      { principalId: "test", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Escalated");
  });

  it("should execute journey stage update", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const result = await cartridge.execute(
      "customer-engagement.journey.update_stage",
      { contactId: "p-1", newStage: "qualified", reason: "Scored above threshold" },
      { principalId: "test", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.undoRecipe).not.toBeNull();
  });

  it("should reject invalid journey stage", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const result = await cartridge.execute(
      "customer-engagement.journey.update_stage",
      { contactId: "p-1", newStage: "invalid_stage" },
      { principalId: "test", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(false);
  });

  it("should execute objection handling", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const result = await cartridge.execute(
      "customer-engagement.conversation.handle_objection",
      { contactId: "p-1", objectionText: "Too expensive for my budget" },
      { principalId: "test", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.matched).toBe(true);
    expect(data.category).toBe("price");
  });

  it("should return health check", async () => {
    const { cartridge } = await bootstrapCustomerEngagementCartridge();
    const health = await cartridge.healthCheck();
    expect(health.status).toBe("connected");
    expect(health.capabilities.length).toBeGreaterThan(0);
  });

  it("should produce interceptors", async () => {
    const { interceptors } = await bootstrapCustomerEngagementCartridge();
    expect(interceptors.length).toBe(3);
  });

  it("should have all 16 actions in manifest", () => {
    expect(CUSTOMER_ENGAGEMENT_MANIFEST.actions.length).toBe(16);
    const actionTypes = CUSTOMER_ENGAGEMENT_MANIFEST.actions.map((a) => a.actionType);
    expect(actionTypes).toContain("customer-engagement.lead.qualify");
    expect(actionTypes).toContain("customer-engagement.appointment.book");
    expect(actionTypes).toContain("customer-engagement.pipeline.diagnose");
    expect(actionTypes).toContain("customer-engagement.review.respond");
  });
});
