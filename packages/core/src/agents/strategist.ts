// ---------------------------------------------------------------------------
// Strategist Agent — Campaign plan generation from business context
// ---------------------------------------------------------------------------
// Reads business profile, skin funnel mode, and current campaign state,
// then generates a structured campaign plan and proposes it through
// governance for the business owner's approval.
// ---------------------------------------------------------------------------

import type { AdsAgent, AgentContext, AgentTickResult } from "./types.js";
import type {
  CampaignPlan,
  PlannedCampaign,
  PlannedAdSet,
  AdCreativeDirection,
  FunnelMode,
  EstimatedMetrics,
} from "@switchboard/schemas";
import { fetchAccountSnapshots } from "./shared.js";

export class StrategistAgent implements AdsAgent {
  readonly id = "strategist";
  readonly name = "Strategist Agent";

  async tick(ctx: AgentContext): Promise<AgentTickResult> {
    const { config, orchestrator } = ctx;
    const actions: Array<{ actionType: string; outcome: string }> = [];

    // ── 1. Gather context ──────────────────────────────────────────────
    const profile = ctx.profile;
    const skin = ctx.skin;

    if (!profile) {
      const summary = "No business profile available. Cannot generate campaign plan.";
      await this.notify(ctx, summary);
      return { agentId: this.id, actions, summary, nextTickAt: this.nextWeeklyTick(config) };
    }

    const funnelMode: FunnelMode = (skin?.manifest.funnelMode as FunnelMode) ?? "lead_gen";
    const vertical = profile.profile.business.type;
    const businessName = profile.profile.business.name;

    // ── 2. Observe — fetch existing campaigns ──────────────────────────
    const { campaigns: existingCampaigns, actions: fetchActions } = await fetchAccountSnapshots(
      ctx,
      "strategist",
    );
    actions.push(...fetchActions);

    const hasExisting =
      existingCampaigns.filter((c) => c.status === "ACTIVE" || c.status === "active").length > 0;

    // ── 3. Generate plan ───────────────────────────────────────────────
    const monthlyBudget = this.inferMonthlyBudget(config, existingCampaigns);
    const budgetTier = this.getBudgetTier(monthlyBudget);
    const objective = this.selectObjective(funnelMode);
    const structure = this.recommendStructure(budgetTier, hasExisting);

    const campaigns = this.buildCampaigns({
      businessName,
      vertical,
      funnelMode,
      objective,
      monthlyBudget,
      structure,
      profile,
      skin,
    });

    const estimatedMetrics = this.estimateMetrics(funnelMode, monthlyBudget, budgetTier);

    const plan: CampaignPlan = {
      id: `plan_${Date.now()}`,
      name: `${businessName} — ${this.funnelModeLabel(funnelMode)} Plan`,
      funnelMode,
      monthlyBudget,
      campaigns,
      estimatedMetrics,
      rationale: this.buildRationale(funnelMode, budgetTier, hasExisting, vertical),
      vertical,
      createdAt: new Date().toISOString(),
    };

    actions.push({ actionType: "strategist.plan.generate", outcome: "generated" });

    // ── 4. Propose plan through governance ─────────────────────────────
    try {
      const proposeResult = await orchestrator.resolveAndPropose({
        actionType: "digital-ads.campaign.create",
        parameters: {
          plan,
          campaignCount: plan.campaigns.length,
          monthlyBudget: plan.monthlyBudget,
          funnelMode: plan.funnelMode,
        },
        principalId: config.principalId,
        cartridgeId: "digital-ads",
        entityRefs: [],
        message: `Strategist proposes campaign plan: ${plan.name}`,
        organizationId: config.organizationId,
      });

      if ("denied" in proposeResult && proposeResult.denied) {
        actions.push({ actionType: "digital-ads.campaign.create", outcome: "denied" });
        const summary = `Campaign plan "${plan.name}" was denied by governance. ${proposeResult.explanation ?? ""}`;
        await this.notify(ctx, summary);
        return { agentId: this.id, actions, summary, nextTickAt: this.nextWeeklyTick(config) };
      }

      if ("approvalRequest" in proposeResult && proposeResult.approvalRequest) {
        actions.push({ actionType: "digital-ads.campaign.create", outcome: "pending_approval" });
        const summary = this.formatPlanSummary(plan, "pending_approval");
        await this.notify(ctx, summary);
        return { agentId: this.id, actions, summary, nextTickAt: this.nextWeeklyTick(config) };
      }

      if ("envelope" in proposeResult && proposeResult.envelope) {
        // Execute the approved plan through the orchestrator
        try {
          await orchestrator.executeApproved(proposeResult.envelope.id);
          actions.push({ actionType: "digital-ads.campaign.create", outcome: "executed" });
        } catch {
          actions.push({ actionType: "digital-ads.campaign.create", outcome: "execution_failed" });
        }
        const summary = this.formatPlanSummary(plan, "approved");
        await this.notify(ctx, summary);
        return { agentId: this.id, actions, summary, nextTickAt: this.nextWeeklyTick(config) };
      }
    } catch {
      actions.push({ actionType: "digital-ads.campaign.create", outcome: "error" });
    }

    const summary = `Campaign plan generated but could not be submitted. ${plan.campaigns.length} campaign(s) planned.`;
    await this.notify(ctx, summary);
    return { agentId: this.id, actions, summary, nextTickAt: this.nextWeeklyTick(config) };
  }

  // ── Budget inference ─────────────────────────────────────────────────

  private inferMonthlyBudget(
    config: AgentContext["config"],
    existingCampaigns: Array<{ budget: number; status: string }>,
  ): number {
    // Use daily budget cap * 30 if set
    if (config.targets.dailyBudgetCap) {
      return config.targets.dailyBudgetCap * 30;
    }

    // Infer from existing campaign spend
    const activeBudgets = existingCampaigns
      .filter((c) => c.status === "ACTIVE" || c.status === "active")
      .reduce((sum, c) => sum + c.budget, 0);

    if (activeBudgets > 0) {
      return activeBudgets * 30;
    }

    // Default for new accounts
    return 500;
  }

  private getBudgetTier(monthlyBudget: number): "micro" | "small" | "medium" | "large" {
    if (monthlyBudget < 500) return "micro";
    if (monthlyBudget < 5000) return "small";
    if (monthlyBudget < 25000) return "medium";
    return "large";
  }

  // ── Objective selection ──────────────────────────────────────────────

  private selectObjective(funnelMode: FunnelMode): string {
    switch (funnelMode) {
      case "lead_gen":
        return "OUTCOME_LEADS";
      case "conversions":
        return "OUTCOME_SALES";
      case "awareness":
        return "OUTCOME_AWARENESS";
    }
  }

  // ── Structure recommendation ─────────────────────────────────────────

  private recommendStructure(
    budgetTier: "micro" | "small" | "medium" | "large",
    hasExisting: boolean,
  ): { campaignCount: number; adSetsPerCampaign: number; adsPerAdSet: number } {
    switch (budgetTier) {
      case "micro":
        return { campaignCount: 1, adSetsPerCampaign: 1, adsPerAdSet: 3 };
      case "small":
        return { campaignCount: hasExisting ? 1 : 2, adSetsPerCampaign: 2, adsPerAdSet: 3 };
      case "medium":
        return { campaignCount: 3, adSetsPerCampaign: 3, adsPerAdSet: 4 };
      case "large":
        return { campaignCount: 4, adSetsPerCampaign: 4, adsPerAdSet: 5 };
    }
  }

  // ── Campaign plan builder ────────────────────────────────────────────

  private buildCampaigns(params: {
    businessName: string;
    vertical: string;
    funnelMode: FunnelMode;
    objective: string;
    monthlyBudget: number;
    structure: { campaignCount: number; adSetsPerCampaign: number; adsPerAdSet: number };
    profile: NonNullable<AgentContext["profile"]>;
    skin: AgentContext["skin"];
  }): PlannedCampaign[] {
    const { businessName, funnelMode, objective, monthlyBudget, structure, profile, skin } = params;

    const dailyBudgetTotal = monthlyBudget / 30;
    const budgetPerCampaign = dailyBudgetTotal / structure.campaignCount;
    const location = this.inferLocation(profile, skin);
    const services = profile.profile.services.catalog;

    const campaigns: PlannedCampaign[] = [];

    for (let i = 0; i < structure.campaignCount; i++) {
      const campaignName =
        structure.campaignCount === 1
          ? `${businessName} — ${this.funnelModeLabel(funnelMode)}`
          : `${businessName} — ${this.funnelModeLabel(funnelMode)} ${i + 1}`;

      const adSets = this.buildAdSets({
        count: structure.adSetsPerCampaign,
        location,
        funnelMode,
        campaignIndex: i,
        services,
      });

      const ads = this.buildAds({
        count: structure.adsPerAdSet,
        businessName,
        funnelMode,
        services,
        profile,
      });

      campaigns.push({
        name: campaignName,
        dailyBudget: Math.round(budgetPerCampaign * 100) / 100,
        objective,
        bidStrategy: this.recommendBidStrategy(funnelMode, monthlyBudget),
        adSets,
        ads,
      });
    }

    return campaigns;
  }

  private buildAdSets(params: {
    count: number;
    location: string;
    funnelMode: FunnelMode;
    campaignIndex: number;
    services: Array<{ name: string; category: string }>;
  }): PlannedAdSet[] {
    const { count, location, funnelMode, services } = params;
    const optimization = this.optimizationGoal(funnelMode);

    const adSets: PlannedAdSet[] = [];
    const audienceStrategies = this.audienceStrategies(count, services);

    for (let i = 0; i < count; i++) {
      const strategy = audienceStrategies[i] ?? { name: `Audience ${i + 1}`, interests: [] };

      const targeting: PlannedAdSet["targeting"] = {
        location,
        ageRange: "25-54",
        interests: strategy.interests.length > 0 ? strategy.interests : undefined,
        advantagePlusAudience: count <= 2,
      };

      adSets.push({
        name: strategy.name,
        targeting,
        optimization,
      });
    }

    return adSets;
  }

  private buildAds(params: {
    count: number;
    businessName: string;
    funnelMode: FunnelMode;
    services: Array<{ name: string; category: string; typicalValue?: number }>;
    profile: NonNullable<AgentContext["profile"]>;
  }): AdCreativeDirection[] {
    const { count, businessName, funnelMode, services, profile } = params;
    const destinationType = this.destinationType(funnelMode);
    const tagline = profile.profile.business.tagline ?? "";
    const topService = services[0];

    const ads: AdCreativeDirection[] = [];
    const angles = this.creativeAngles(businessName, topService, tagline, count);

    for (let i = 0; i < count; i++) {
      const angle = angles[i] ?? angles[0]!;
      ads.push({
        type: i === 0 ? "image" : i === 1 ? "video" : "carousel",
        source: "generated",
        headline: angle.headline,
        body: angle.body,
        cta: angle.cta,
        destinationType,
      });
    }

    return ads;
  }

  // ── Creative direction helpers ───────────────────────────────────────

  private creativeAngles(
    businessName: string,
    topService: { name: string; category: string; typicalValue?: number } | undefined,
    tagline: string,
    count: number,
  ): Array<{ headline: string; body: string; cta: string }> {
    const serviceName = topService?.name ?? "our services";
    const angles = [
      {
        headline: tagline || `${businessName} — Book Today`,
        body: `Discover ${serviceName} at ${businessName}. Professional results you'll love.`,
        cta: "Learn More",
      },
      {
        headline: `Why Choose ${businessName}?`,
        body: `Trusted by locals for quality ${serviceName}. See the difference for yourself.`,
        cta: "Get Started",
      },
      {
        headline: `${serviceName} — Now Available`,
        body: `${businessName} is ready to help. Quick, professional, and hassle-free.`,
        cta: "Book Now",
      },
      {
        headline: `Special from ${businessName}`,
        body: `Get expert ${serviceName} from a team that cares. Message us today.`,
        cta: "Contact Us",
      },
      {
        headline: `Ready for ${serviceName}?`,
        body: `${businessName} makes it easy. Fast response, great results.`,
        cta: "Sign Up",
      },
    ];
    return angles.slice(0, Math.max(count, 1));
  }

  private audienceStrategies(
    count: number,
    services: Array<{ name: string; category: string }>,
  ): Array<{ name: string; interests: string[] }> {
    const categories = [...new Set(services.map((s) => s.category))];
    const strategies: Array<{ name: string; interests: string[] }> = [
      { name: "Broad — Advantage+ Audience", interests: [] },
    ];

    for (const cat of categories.slice(0, count - 1)) {
      strategies.push({
        name: `${cat} Interest`,
        interests: [cat.toLowerCase()],
      });
    }

    // Pad remaining with lookalike-style names
    while (strategies.length < count) {
      strategies.push({
        name: `Lookalike ${strategies.length}`,
        interests: [],
      });
    }

    return strategies;
  }

  // ── Mapping helpers ──────────────────────────────────────────────────

  private optimizationGoal(funnelMode: FunnelMode): string {
    switch (funnelMode) {
      case "lead_gen":
        return "LEAD_GENERATION";
      case "conversions":
        return "CONVERSIONS";
      case "awareness":
        return "REACH";
    }
  }

  private destinationType(
    funnelMode: FunnelMode,
  ): "lead_form" | "telegram_bot" | "website" | "messenger" {
    switch (funnelMode) {
      case "lead_gen":
        return "lead_form";
      case "conversions":
        return "website";
      case "awareness":
        return "website";
    }
  }

  private recommendBidStrategy(funnelMode: FunnelMode, monthlyBudget: number): string {
    if (monthlyBudget < 500) return "LOWEST_COST_WITHOUT_CAP";
    if (funnelMode === "conversions") return "COST_CAP";
    if (funnelMode === "awareness") return "LOWEST_COST_WITHOUT_CAP";
    return "COST_CAP";
  }

  private funnelModeLabel(funnelMode: FunnelMode): string {
    switch (funnelMode) {
      case "lead_gen":
        return "Lead Generation";
      case "conversions":
        return "Conversions";
      case "awareness":
        return "Brand Awareness";
    }
  }

  private inferLocation(
    profile: NonNullable<AgentContext["profile"]>,
    skin: AgentContext["skin"],
  ): string {
    // Try to extract from skin config or profile
    const skinConfig = skin?.config ?? {};
    if (typeof skinConfig["defaultLocation"] === "string") {
      return skinConfig["defaultLocation"];
    }
    // Fall back to a generic location
    const timezone = profile.profile.business.timezone;
    if (timezone?.includes("America")) return "United States";
    if (timezone?.includes("Europe")) return "United Kingdom";
    return "United States";
  }

  // ── Metrics estimation ───────────────────────────────────────────────

  private estimateMetrics(
    funnelMode: FunnelMode,
    monthlyBudget: number,
    budgetTier: "micro" | "small" | "medium" | "large",
  ): EstimatedMetrics {
    // Industry-approximate CPL/CPA by tier and funnel mode
    const cplBase = funnelMode === "lead_gen" ? 15 : funnelMode === "conversions" ? 25 : 5;
    const tierMultiplier =
      budgetTier === "micro"
        ? 1.5
        : budgetTier === "small"
          ? 1.2
          : budgetTier === "medium"
            ? 1.0
            : 0.85;

    const estimatedCpl = Math.round(cplBase * tierMultiplier * 100) / 100;
    const estimatedConversions = Math.round(monthlyBudget / estimatedCpl);
    const estimatedReach = Math.round(monthlyBudget * (funnelMode === "awareness" ? 200 : 50));

    return {
      cpl: funnelMode === "lead_gen" ? estimatedCpl : undefined,
      cpa: funnelMode === "conversions" ? estimatedCpl : undefined,
      reach: estimatedReach,
      impressions: Math.round(estimatedReach * 3),
      conversions: estimatedConversions,
    };
  }

  // ── Rationale ────────────────────────────────────────────────────────

  private buildRationale(
    funnelMode: FunnelMode,
    budgetTier: "micro" | "small" | "medium" | "large",
    hasExisting: boolean,
    vertical: string,
  ): string {
    const parts: string[] = [];

    parts.push(
      `This ${this.funnelModeLabel(funnelMode).toLowerCase()} plan is designed for a ${vertical} business`,
    );

    switch (budgetTier) {
      case "micro":
        parts.push(
          "with a limited budget. We recommend a single consolidated campaign to avoid fragmenting spend.",
        );
        break;
      case "small":
        parts.push(
          "with a moderate budget. We recommend 1-2 campaigns with audience testing across ad sets.",
        );
        break;
      case "medium":
        parts.push(
          "with a healthy budget. We recommend 3 campaigns with CBO and creative testing.",
        );
        break;
      case "large":
        parts.push(
          "with a strong budget. We recommend a full campaign mix with ASC and measurement testing.",
        );
        break;
    }

    if (hasExisting) {
      parts.push("This plan complements your existing active campaigns.");
    }

    if (funnelMode === "lead_gen") {
      parts.push(
        "Lead generation campaigns use Lead Ads to capture contact information directly on the platform.",
      );
    } else if (funnelMode === "conversions") {
      parts.push(
        "Conversion campaigns drive traffic to your website and optimize for purchase events.",
      );
    }

    return parts.join(" ");
  }

  // ── Plan summary formatting ──────────────────────────────────────────

  private formatPlanSummary(plan: CampaignPlan, status: "approved" | "pending_approval"): string {
    const totalAdSets = plan.campaigns.reduce((sum, c) => sum + c.adSets.length, 0);
    const totalAds = plan.campaigns.reduce((sum, c) => sum + c.ads.length, 0);
    const dailyBudget = plan.campaigns.reduce((sum, c) => sum + c.dailyBudget, 0);

    const lines: string[] = [
      `Campaign Plan: ${plan.name}`,
      `Status: ${status === "approved" ? "Approved" : "Awaiting Your Approval"}`,
      `Budget: $${dailyBudget.toFixed(0)}/day ($${plan.monthlyBudget.toFixed(0)}/month)`,
      `Structure: ${plan.campaigns.length} campaign(s), ${totalAdSets} ad set(s), ${totalAds} ad(s)`,
    ];

    if (plan.estimatedMetrics.conversions) {
      lines.push(`Est. conversions: ~${plan.estimatedMetrics.conversions}/month`);
    }
    if (plan.estimatedMetrics.cpl) {
      lines.push(`Est. cost per lead: $${plan.estimatedMetrics.cpl.toFixed(2)}`);
    }
    if (plan.estimatedMetrics.cpa) {
      lines.push(`Est. cost per acquisition: $${plan.estimatedMetrics.cpa.toFixed(2)}`);
    }

    lines.push("");
    lines.push(plan.rationale);

    return lines.join("\n");
  }

  // ── Notification helper ──────────────────────────────────────────────

  private nextWeeklyTick(config: AgentContext["config"]): Date {
    const next = new Date();
    next.setDate(next.getDate() + 7);
    next.setHours(config.schedule.reportCronHour, 0, 0, 0);
    return next;
  }

  private async notify(ctx: AgentContext, summary: string): Promise<void> {
    try {
      await ctx.notifier.sendProactive(
        ctx.config.notificationChannel.chatId,
        ctx.config.notificationChannel.type,
        summary,
      );
    } catch {
      // Non-critical — agent should not fail on notification errors
    }
  }
}
