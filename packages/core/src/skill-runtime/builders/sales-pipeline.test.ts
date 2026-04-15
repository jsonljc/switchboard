import { describe, it, expect, vi } from "vitest";
import { salesPipelineBuilder } from "./sales-pipeline.js";
import { ParameterResolutionError } from "../parameter-builder.js";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    persona: {
      businessName: "TestBiz",
      tone: "friendly",
      qualificationCriteria: { budget: "has budget" },
      disqualificationCriteria: { location: "wrong country" },
      escalationRules: { pricing: true },
      bookingLink: "https://book.test",
      customInstructions: "Be nice",
    },
    conversation: { id: "session-1", messages: [{ role: "user", content: "hi" }] },
    trust: { score: 50, level: "guided" },
    ...overrides,
  } as any;
}

const mockStores = {
  opportunityStore: {
    findActiveByContact: vi.fn(),
  },
  contactStore: {
    findById: vi.fn(),
  },
  activityStore: {
    listByDeployment: vi.fn(),
  },
};

const config = { deploymentId: "d1", orgId: "org1", contactId: "session-1" };

describe("salesPipelineBuilder", () => {
  it("throws ParameterResolutionError when no active opportunities", async () => {
    mockStores.opportunityStore.findActiveByContact.mockResolvedValue([]);
    await expect(salesPipelineBuilder(makeCtx(), config, mockStores)).rejects.toThrow(
      ParameterResolutionError,
    );
  });

  it("resolves parameters from most recent opportunity", async () => {
    const older = { id: "opp1", stage: "interested", createdAt: new Date("2025-01-01") };
    const newer = { id: "opp2", stage: "qualified", createdAt: new Date("2026-01-01") };
    mockStores.opportunityStore.findActiveByContact.mockResolvedValue([older, newer]);
    mockStores.contactStore.findById.mockResolvedValue({ id: "c1", name: "Alice" });

    const result = await salesPipelineBuilder(makeCtx(), config, mockStores);

    expect(result.BUSINESS_NAME).toBe("TestBiz");
    expect(result.PIPELINE_STAGE).toBe("qualified");
    expect(result.OPPORTUNITY_ID).toBe("opp2");
    expect(result.LEAD_PROFILE).toEqual({ id: "c1", name: "Alice" });
    expect((result.PERSONA_CONFIG as any).tone).toBe("friendly");
    expect((result.PERSONA_CONFIG as any).bookingLink).toBe("https://book.test");
  });

  it("uses config.contactId as contactId", async () => {
    mockStores.opportunityStore.findActiveByContact.mockResolvedValue([
      { id: "opp1", stage: "interested", createdAt: new Date() },
    ]);
    mockStores.contactStore.findById.mockResolvedValue(null);

    const phoneConfig = { deploymentId: "d1", orgId: "org1", contactId: "phone-123" };
    await salesPipelineBuilder(makeCtx(), phoneConfig, mockStores);

    expect(mockStores.opportunityStore.findActiveByContact).toHaveBeenCalledWith(
      "org1",
      "phone-123",
    );
    expect(mockStores.contactStore.findById).toHaveBeenCalledWith("org1", "phone-123");
  });

  it("handles null bookingLink and customInstructions", async () => {
    mockStores.opportunityStore.findActiveByContact.mockResolvedValue([
      { id: "opp1", stage: "interested", createdAt: new Date() },
    ]);
    mockStores.contactStore.findById.mockResolvedValue(null);

    const ctx = makeCtx();
    ctx.persona.bookingLink = null;
    ctx.persona.customInstructions = null;

    const result = await salesPipelineBuilder(ctx, config, mockStores);
    expect((result.PERSONA_CONFIG as any).bookingLink).toBe("");
    expect((result.PERSONA_CONFIG as any).customInstructions).toBe("");
  });
});
