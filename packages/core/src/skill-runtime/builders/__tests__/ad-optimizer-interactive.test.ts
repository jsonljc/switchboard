import { describe, it, expect, vi } from "vitest";
import { adOptimizerInteractiveBuilder } from "../ad-optimizer-interactive.js";

describe("adOptimizerInteractiveBuilder", () => {
  it("returns DEPLOYMENT_CONFIG resolved via resolveAdOptimizerConfig (typed fields + passthrough extras)", async () => {
    const ctx = {
      persona: { businessName: "Test Biz", tone: "professional" },
      deployment: {
        inputConfig: {
          monthlyBudget: 5000,
          targetCPA: 25,
          targetROAS: 3.0,
          auditFrequency: "weekly",
          pixelId: "123456",
        },
      },
      conversation: { messages: [{ content: "Audit my campaigns" }] },
    } as unknown as Parameters<typeof adOptimizerInteractiveBuilder>[0];

    const config = { deploymentId: "dep_ao", orgId: "org_test", contactId: "c_1" };
    const stores = {
      opportunityStore: { findActiveByContact: vi.fn(async () => []) },
      contactStore: { findById: vi.fn(async () => null) },
      activityStore: { listByDeployment: vi.fn(async () => []) },
    };

    const result = await adOptimizerInteractiveBuilder(ctx, config, stores);

    expect(result.DEPLOYMENT_CONFIG).toEqual({
      monthlyBudget: 5000,
      targetCPA: 25,
      targetROAS: 3.0,
      auditFrequency: "weekly",
      pixelId: "123456",
    });
    expect(result.BUSINESS_NAME).toBe("Test Biz");
    expect(result.PERSONA_CONFIG).toBeDefined();
  });

  it("fills schema defaults when inputConfig is empty", async () => {
    const ctx = {
      persona: { businessName: "Empty Biz", tone: "casual" },
      deployment: { inputConfig: {} },
      conversation: { messages: [] },
    } as unknown as Parameters<typeof adOptimizerInteractiveBuilder>[0];

    const config = { deploymentId: "dep_ao2", orgId: "org_test", contactId: "c_2" };
    const stores = {
      opportunityStore: { findActiveByContact: vi.fn(async () => []) },
      contactStore: { findById: vi.fn(async () => null) },
      activityStore: { listByDeployment: vi.fn(async () => []) },
    };

    const result = await adOptimizerInteractiveBuilder(ctx, config, stores);
    expect(result.DEPLOYMENT_CONFIG).toEqual({
      targetCPA: 100,
      targetROAS: 3,
      monthlyBudget: 0,
    });
    expect(result.BUSINESS_NAME).toBe("Empty Biz");
  });
});
