import { describe, it, expect, vi, beforeEach } from "vitest";
import { GuardrailAgent, DEFAULT_GUARDRAIL_RULES } from "../guardrail-agent.js";
import type { AgentContext } from "../types.js";
import type { CampaignGuardrailData } from "../guardrail-agent.js";
import type { AdsOperatorConfig } from "@switchboard/schemas";

function makeConfig(overrides?: Partial<AdsOperatorConfig>): AdsOperatorConfig {
  return {
    id: "op_1",
    organizationId: "org_1",
    adAccountIds: ["act_123"],
    platforms: ["meta"],
    automationLevel: "supervised",
    targets: { cpa: 15, roas: 3, dailyBudgetCap: 100 },
    schedule: { optimizerCronHour: 3, reportCronHour: 9, timezone: "America/New_York" },
    notificationChannel: { type: "telegram", chatId: "chat_1" },
    principalId: "user_1",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AdsOperatorConfig;
}

function makeMockContext(config?: Partial<AdsOperatorConfig>): AgentContext {
  return {
    config: makeConfig(config),
    orchestrator: {
      resolveAndPropose: vi.fn().mockResolvedValue({
        denied: false,
        envelope: { id: "env_1" },
      }),
      executeApproved: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: "camp_1",
            name: "act_123_Spring_Sale",
            metrics: { spend: 50, impressions: 10000, clicks: 200, conversions: 10 },
            budget: 100,
            status: "ACTIVE",
          },
          {
            id: "camp_2",
            name: "act_123_Brand_Awareness",
            metrics: { spend: 30, impressions: 8000, clicks: 160, conversions: 5 },
            budget: 80,
            status: "ACTIVE",
          },
        ],
      }),
    } as unknown as AgentContext["orchestrator"],
    storage: {} as AgentContext["storage"],
    notifier: {
      sendProactive: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeCampaignData(overrides?: Partial<CampaignGuardrailData>): CampaignGuardrailData {
  return {
    id: "camp_1",
    name: "act_123_Test_Campaign",
    spend: 50,
    budget: 100,
    impressions: 10000,
    clicks: 200,
    conversions: 10,
    status: "ACTIVE",
    accountPrefix: "act_123",
    ...overrides,
  };
}

describe("GuardrailAgent", () => {
  let agent: GuardrailAgent;

  beforeEach(() => {
    agent = new GuardrailAgent();
  });

  it("has correct id and name", () => {
    expect(agent.id).toBe("guardrail");
    expect(agent.name).toBe("Guardrail Agent");
  });

  it("detects spend cap violations", async () => {
    const ctx = makeMockContext();
    (ctx.orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [
        {
          id: "camp_1",
          name: "act_123_Overspender",
          metrics: { spend: 135, impressions: 10000, clicks: 200, conversions: 10 },
          budget: 100,
          status: "ACTIVE",
        },
      ],
    });

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("guardrail");
    expect(result.actions).toContainEqual(
      expect.objectContaining({ actionType: "guardrail.check", outcome: "violations_found" }),
    );
  });

  it("detects zero-conversion spend", async () => {
    const ctx = makeMockContext();
    (ctx.orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [
        {
          id: "camp_1",
          name: "act_123_Wasteful",
          metrics: { spend: 60, impressions: 5000, clicks: 100, conversions: 0 },
          budget: 100,
          status: "ACTIVE",
        },
      ],
    });

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("guardrail");
    expect(result.actions).toContainEqual(
      expect.objectContaining({ actionType: "guardrail.check", outcome: "violations_found" }),
    );
  });

  it("detects CTR anomaly", async () => {
    const ctx = makeMockContext();
    (ctx.orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [
        {
          id: "camp_1",
          name: "act_123_Low_CTR",
          metrics: { spend: 50, impressions: 10000, clicks: 30, conversions: 5 },
          budget: 100,
          status: "ACTIVE",
        },
      ],
    });

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("guardrail");
    expect(result.actions).toContainEqual(
      expect.objectContaining({ actionType: "guardrail.check", outcome: "violations_found" }),
    );
  });

  it("reports no violations when all healthy", async () => {
    const ctx = makeMockContext();
    // Default mock data has healthy campaigns
    (ctx.orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [
        {
          id: "camp_1",
          name: "act_123_Healthy",
          metrics: { spend: 50, impressions: 10000, clicks: 200, conversions: 10 },
          budget: 100,
          status: "ACTIVE",
        },
      ],
    });

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("guardrail");
    expect(result.actions).toContainEqual(
      expect.objectContaining({ actionType: "guardrail.check", outcome: "clean" }),
    );
  });

  it("proposes pause action for critical violations", async () => {
    const ctx = makeMockContext();
    (ctx.orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [
        {
          id: "camp_1",
          name: "act_123_Overspender",
          metrics: { spend: 140, impressions: 10000, clicks: 200, conversions: 10 },
          budget: 100,
          status: "ACTIVE",
        },
      ],
    });

    await agent.tick(ctx);

    // Should call orchestrator to propose pausing the overspending campaign
    expect(ctx.orchestrator.resolveAndPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: expect.stringContaining("pause"),
      }),
    );
  });

  it("sends violation report via notifier", async () => {
    const ctx = makeMockContext();
    (ctx.orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [
        {
          id: "camp_1",
          name: "act_123_Overspender",
          metrics: { spend: 135, impressions: 10000, clicks: 200, conversions: 10 },
          budget: 100,
          status: "ACTIVE",
        },
      ],
    });

    await agent.tick(ctx);

    expect(ctx.notifier.sendProactive).toHaveBeenCalledTimes(1);
    expect(ctx.notifier.sendProactive).toHaveBeenCalledWith(
      "chat_1",
      "telegram",
      expect.stringContaining("violation"),
    );
  });

  it("handles fetch errors gracefully", async () => {
    const ctx = makeMockContext();
    (ctx.orchestrator.resolveAndPropose as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("API down"),
    );

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("guardrail");
    expect(result.actions).toContainEqual(
      expect.objectContaining({ actionType: "guardrail.fetch", outcome: "error" }),
    );
  });

  it("schedules next tick", async () => {
    const ctx = makeMockContext();
    const result = await agent.tick(ctx);

    expect(result.nextTickAt).toBeDefined();
    expect(result.nextTickAt).toBeInstanceOf(Date);
    expect(result.nextTickAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("DEFAULT_GUARDRAIL_RULES", () => {
  it("has 4 default rules", () => {
    expect(DEFAULT_GUARDRAIL_RULES).toHaveLength(4);
  });

  it("spend_cap: triggers critical at 130%+", () => {
    const spendCap = DEFAULT_GUARDRAIL_RULES.find((r) => r.id === "spend_cap")!;
    const campaign = makeCampaignData({ spend: 135, budget: 100 });

    const result = spendCap.evaluate(campaign);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
    expect(result!.ruleId).toBe("spend_cap");
  });

  it("spend_cap: triggers warning at 110-130%", () => {
    const spendCap = DEFAULT_GUARDRAIL_RULES.find((r) => r.id === "spend_cap")!;
    const campaign = makeCampaignData({ spend: 115, budget: 100 });

    const result = spendCap.evaluate(campaign);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.ruleId).toBe("spend_cap");
  });

  it("spend_cap: passes at 100%", () => {
    const spendCap = DEFAULT_GUARDRAIL_RULES.find((r) => r.id === "spend_cap")!;
    const campaign = makeCampaignData({ spend: 100, budget: 100 });

    const result = spendCap.evaluate(campaign);

    expect(result).toBeNull();
  });

  it("zero_conversion_spend: triggers at $50+ spend with 0 conversions", () => {
    const zeroConv = DEFAULT_GUARDRAIL_RULES.find((r) => r.id === "zero_conversion_spend")!;
    const campaign = makeCampaignData({ spend: 60, conversions: 0 });

    const result = zeroConv.evaluate(campaign);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.ruleId).toBe("zero_conversion_spend");
  });

  it("zero_conversion_spend: passes with conversions", () => {
    const zeroConv = DEFAULT_GUARDRAIL_RULES.find((r) => r.id === "zero_conversion_spend")!;
    const campaign = makeCampaignData({ spend: 60, conversions: 5 });

    const result = zeroConv.evaluate(campaign);

    expect(result).toBeNull();
  });

  it("ctr_anomaly: triggers below 0.5%", () => {
    const ctrAnomaly = DEFAULT_GUARDRAIL_RULES.find((r) => r.id === "ctr_anomaly")!;
    // CTR = clicks / impressions = 30 / 10000 = 0.3%
    const campaign = makeCampaignData({ impressions: 10000, clicks: 30 });

    const result = ctrAnomaly.evaluate(campaign);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.ruleId).toBe("ctr_anomaly");
  });

  it("ctr_anomaly: passes at normal CTR", () => {
    const ctrAnomaly = DEFAULT_GUARDRAIL_RULES.find((r) => r.id === "ctr_anomaly")!;
    // CTR = clicks / impressions = 200 / 10000 = 2%
    const campaign = makeCampaignData({ impressions: 10000, clicks: 200 });

    const result = ctrAnomaly.evaluate(campaign);

    expect(result).toBeNull();
  });

  it("naming_convention: triggers when name missing account prefix", () => {
    const naming = DEFAULT_GUARDRAIL_RULES.find((r) => r.id === "naming_convention")!;
    const campaign = makeCampaignData({
      name: "Bad_Campaign_Name",
      accountPrefix: "act_123",
    });

    const result = naming.evaluate(campaign);

    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("naming_convention");
  });
});
