import { describe, it, expect } from "vitest";
import {
  AdsSpendCartridge,
  ADS_SPEND_MANIFEST,
  DEFAULT_ADS_GUARDRAILS,
  DEFAULT_ADS_POLICIES,
} from "../index.js";
import {
  computeAdsBudgetRiskInput,
  computeAdsPauseRiskInput,
  computeAdsTargetingRiskInput,
} from "../risk/categories.js";
import {
  buildPauseUndoRecipe,
  buildResumeUndoRecipe,
  buildBudgetUndoRecipe,
} from "../actions/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "camp_1",
    name: "Test Campaign",
    status: "ACTIVE" as const,
    dailyBudget: 10000, // $100 in cents
    lifetimeBudget: null,
    deliveryStatus: "ACTIVE",
    startTime: new Date().toISOString(),
    endTime: null,
    objective: "CONVERSIONS",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Manifest
// ---------------------------------------------------------------------------
describe("ADS_SPEND_MANIFEST", () => {
  it("has correct id and actions", () => {
    expect(ADS_SPEND_MANIFEST.id).toBe("ads-spend");
    expect(ADS_SPEND_MANIFEST.name).toBe("Ads Spend Management");
    expect(ADS_SPEND_MANIFEST.version).toBe("1.0.0");
    expect(ADS_SPEND_MANIFEST.actions).toHaveLength(4);

    const actionTypes = ADS_SPEND_MANIFEST.actions.map((a) => a.actionType);
    expect(actionTypes).toContain("ads.campaign.pause");
    expect(actionTypes).toContain("ads.campaign.resume");
    expect(actionTypes).toContain("ads.budget.adjust");
    expect(actionTypes).toContain("ads.targeting.modify");
  });

  it("all actions have baseRiskCategory", () => {
    const validCategories = ["none", "low", "medium", "high", "critical"];
    for (const actionDef of ADS_SPEND_MANIFEST.actions) {
      expect(validCategories).toContain(actionDef.baseRiskCategory);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Risk Input computation
// ---------------------------------------------------------------------------
describe("Risk Input computation", () => {
  it("budget adjust risk input calculates dollarsAtRisk", () => {
    const campaign = makeCampaign(); // $100/day, no end date -> 30 remaining days
    const riskInput = computeAdsBudgetRiskInput(
      { campaignId: "camp_1", newBudget: 200 },
      campaign,
    );

    // |200 - 100| * 30 = 3000
    expect(riskInput.baseRisk).toBe("high");
    expect(riskInput.exposure.dollarsAtRisk).toBe(3000);
    expect(riskInput.reversibility).toBe("full");
  });

  it("pause risk input has full reversibility", () => {
    const campaign = makeCampaign();
    const riskInput = computeAdsPauseRiskInput(campaign);

    expect(riskInput.baseRisk).toBe("medium");
    expect(riskInput.exposure.dollarsAtRisk).toBe(100); // $100 daily budget
    expect(riskInput.reversibility).toBe("full");
    expect(riskInput.sensitivity.learningPhase).toBe(false);
  });

  it("targeting risk input has partial reversibility and learning phase", () => {
    const campaign = makeCampaign(); // $100/day, no end -> 30 days
    const riskInput = computeAdsTargetingRiskInput(campaign, 10000);

    expect(riskInput.baseRisk).toBe("high");
    // $100 * 30 = $3000
    expect(riskInput.exposure.dollarsAtRisk).toBe(3000);
    expect(riskInput.exposure.blastRadius).toBe(10); // 10000 / 1000
    expect(riskInput.reversibility).toBe("partial");
    expect(riskInput.sensitivity.learningPhase).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. UndoRecipe builders
// ---------------------------------------------------------------------------
describe("UndoRecipe builders", () => {
  it("pause undo recipe creates resume action", () => {
    const recipe = buildPauseUndoRecipe("camp_1", "env_1", "act_1", "ACTIVE");

    expect(recipe.reverseActionType).toBe("ads.campaign.resume");
    expect(recipe.reverseParameters).toEqual({
      campaignId: "camp_1",
      previousStatus: "ACTIVE",
    });
    expect(recipe.originalActionId).toBe("act_1");
    expect(recipe.originalEnvelopeId).toBe("env_1");
    expect(recipe.undoRiskCategory).toBe("medium");
    expect(recipe.undoApprovalRequired).toBe("none");
    expect(recipe.undoExpiresAt).toBeInstanceOf(Date);
  });

  it("resume undo recipe creates pause action", () => {
    const recipe = buildResumeUndoRecipe("camp_2", "env_2", "act_2");

    expect(recipe.reverseActionType).toBe("ads.campaign.pause");
    expect(recipe.reverseParameters).toEqual({ campaignId: "camp_2" });
    expect(recipe.undoRiskCategory).toBe("medium");
    expect(recipe.undoApprovalRequired).toBe("none");
  });

  it("budget undo recipe stores previous budget", () => {
    const recipe = buildBudgetUndoRecipe("camp_3", "env_3", "act_3", 150);

    expect(recipe.reverseActionType).toBe("ads.budget.adjust");
    expect(recipe.reverseParameters).toEqual({
      campaignId: "camp_3",
      newBudget: 150,
    });
    expect(recipe.undoRiskCategory).toBe("high");
    expect(recipe.undoApprovalRequired).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// 4. Guardrails
// ---------------------------------------------------------------------------
describe("DEFAULT_ADS_GUARDRAILS", () => {
  it("has default rate limits", () => {
    expect(DEFAULT_ADS_GUARDRAILS.rateLimits.length).toBeGreaterThanOrEqual(2);

    const budgetRateLimit = DEFAULT_ADS_GUARDRAILS.rateLimits.find(
      (r) => r.scope === "ads.budget.adjust",
    );
    expect(budgetRateLimit).toBeDefined();
    expect(budgetRateLimit!.maxActions).toBe(10);

    const globalRateLimit = DEFAULT_ADS_GUARDRAILS.rateLimits.find(
      (r) => r.scope === "global",
    );
    expect(globalRateLimit).toBeDefined();
    expect(globalRateLimit!.maxActions).toBe(50);
  });

  it("has default cooldown for budget adjust", () => {
    expect(DEFAULT_ADS_GUARDRAILS.cooldowns.length).toBeGreaterThanOrEqual(1);

    const budgetCooldown = DEFAULT_ADS_GUARDRAILS.cooldowns.find(
      (c) => c.actionType === "ads.budget.adjust",
    );
    expect(budgetCooldown).toBeDefined();
    expect(budgetCooldown!.cooldownMs).toBe(6 * 60 * 60 * 1000); // 6 hours
    expect(budgetCooldown!.scope).toBe("campaign");
  });
});

// ---------------------------------------------------------------------------
// 5. Default policies
// ---------------------------------------------------------------------------
describe("DEFAULT_ADS_POLICIES", () => {
  it("has a large budget increase policy", () => {
    const policy = DEFAULT_ADS_POLICIES.find(
      (p) => p.id === "ads-large-budget-increase",
    );
    expect(policy).toBeDefined();
    expect(policy!.effect).toBe("require_approval");
    expect(policy!.approvalRequirement).toBe("elevated");
    expect(policy!.active).toBe(true);
    expect(policy!.cartridgeId).toBe("ads-spend");
  });

  it("has a learning phase deny policy", () => {
    const policy = DEFAULT_ADS_POLICIES.find(
      (p) => p.id === "ads-deny-during-learning",
    );
    expect(policy).toBeDefined();
    expect(policy!.effect).toBe("deny");
    expect(policy!.active).toBe(true);
    expect(policy!.cartridgeId).toBe("ads-spend");
  });
});

// ---------------------------------------------------------------------------
// 6. Cartridge integration
// ---------------------------------------------------------------------------
describe("AdsSpendCartridge integration", () => {
  async function createInitializedCartridge() {
    const cartridge = new AdsSpendCartridge();
    await cartridge.initialize({
      principalId: "user_1",
      organizationId: null,
      connectionCredentials: { accessToken: "test_token", adAccountId: "act_123" },
    });
    return cartridge;
  }

  it("initializes cartridge with credentials", async () => {
    const cartridge = await createInitializedCartridge();

    // Verify initialized by checking manifest and that operations don't throw
    expect(cartridge.manifest.id).toBe("ads-spend");
    const health = await cartridge.healthCheck();
    expect(health.status).toBe("connected");
  });

  it("executes pause campaign", async () => {
    const cartridge = await createInitializedCartridge();

    const result = await cartridge.execute(
      "ads.campaign.pause",
      { campaignId: "camp_abc" },
      { principalId: "user_1", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("camp_abc");
    expect(result.summary).toContain("paused");
    expect(result.rollbackAvailable).toBe(true);
    expect(result.undoRecipe).not.toBeNull();
    expect(result.undoRecipe!.reverseActionType).toBe("ads.campaign.resume");
    expect(result.externalRefs["campaignId"]).toBe("camp_abc");
  });

  it("executes budget adjust", async () => {
    const cartridge = await createInitializedCartridge();

    const result = await cartridge.execute(
      "ads.budget.adjust",
      { campaignId: "camp_xyz", newBudget: 200 },
      { principalId: "user_1", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("camp_xyz");
    expect(result.summary).toContain("$200");
    expect(result.rollbackAvailable).toBe(true);
    expect(result.undoRecipe).not.toBeNull();
    expect(result.undoRecipe!.reverseActionType).toBe("ads.budget.adjust");
    expect(result.undoRecipe!.reverseParameters["newBudget"]).toBe(50); // previous: 5000 cents -> $50
  });

  it("enriches context with campaign info", async () => {
    const cartridge = await createInitializedCartridge();

    const enriched = await cartridge.enrichContext(
      "ads.campaign.pause",
      { campaignId: "camp_enrich" },
      { principalId: "user_1", organizationId: null, connectionCredentials: {} },
    );

    expect(enriched["campaignName"]).toBe("Campaign camp_enrich");
    expect(enriched["campaignStatus"]).toBe("ACTIVE");
    expect(enriched["currentBudget"]).toBe(50); // 5000 cents -> $50
    expect(enriched["objective"]).toBe("CONVERSIONS");
  });

  it("health check returns connected", async () => {
    const cartridge = await createInitializedCartridge();

    const health = await cartridge.healthCheck();

    expect(health.status).toBe("connected");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.error).toBeNull();
    expect(health.capabilities).toContain("ads.campaign.pause");
    expect(health.capabilities).toContain("ads.budget.adjust");
  });
});
