import { describe, it, expect, vi } from "vitest";
import { alexBuilder } from "./alex.js";
import type { AgentContext } from "@switchboard/sdk";
import type { SkillStores } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";

function createMockCtx(overrides?: Partial<AgentContext>): AgentContext {
  return {
    persona: {
      businessName: "Glow Aesthetics",
      tone: "friendly",
      qualificationCriteria: { budget: "above 200 SGD" },
      disqualificationCriteria: { underage: true },
      escalationRules: { complexCases: true },
      bookingLink: "https://cal.com/glow-aesthetics",
      customInstructions: "Always mention first-visit discount",
    },
    ...overrides,
  } as AgentContext;
}

function createMockStores(overrides?: Partial<SkillStores>): SkillStores {
  return {
    opportunityStore: {
      findActiveByContact: vi
        .fn()
        .mockResolvedValue([{ id: "opp_1", stage: "interested", createdAt: new Date() }]),
    },
    contactStore: {
      findById: vi.fn().mockResolvedValue({
        name: "Sarah",
        phone: "+6591234567",
        email: "sarah@example.com",
        source: "whatsapp",
      }),
    },
    activityStore: {
      listByDeployment: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as SkillStores;
}

const config = {
  deploymentId: "dep_1",
  orgId: "org_1",
  contactId: "contact_1",
  sessionId: "session_1",
};

describe("alexBuilder", () => {
  it("resolves parameters from context and stores", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, config, stores);

    expect(result.BUSINESS_NAME).toBe("Glow Aesthetics");
    expect(result.OPPORTUNITY_ID).toBe("opp_1");
    expect(result.LEAD_PROFILE).toEqual(expect.objectContaining({ name: "Sarah" }));
    expect(result.PERSONA_CONFIG).toEqual(
      expect.objectContaining({
        tone: "friendly",
        bookingLink: "https://cal.com/glow-aesthetics",
      }),
    );
  });

  it("throws ParameterResolutionError when no active opportunity exists", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([]),
      } as never,
    });

    await expect(alexBuilder(ctx, config, stores)).rejects.toThrow(ParameterResolutionError);
  });

  it("picks most recent opportunity when multiple exist", async () => {
    const ctx = createMockCtx();
    const older = { id: "opp_old", stage: "interested", createdAt: new Date("2026-01-01") };
    const newer = { id: "opp_new", stage: "qualified", createdAt: new Date("2026-04-15") };
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([older, newer]),
      } as never,
    });

    const result = await alexBuilder(ctx, config, stores);
    expect(result.OPPORTUNITY_ID).toBe("opp_new");
  });

  it("does not include PIPELINE_STAGE parameter", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, config, stores);

    expect(result).not.toHaveProperty("PIPELINE_STAGE");
  });
});
