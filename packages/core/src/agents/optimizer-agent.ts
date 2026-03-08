// ---------------------------------------------------------------------------
// Optimizer Agent — Autonomous daily optimization
// ---------------------------------------------------------------------------
// Observes ad account health, evaluates rules, runs optimization passes,
// and proposes budget adjustments through governance.
// ---------------------------------------------------------------------------

import type { AdsAgent, AgentContext, AgentTickResult } from "./types.js";
import { automationLevelToProfile } from "../identity/governance-presets.js";

export class OptimizerAgent implements AdsAgent {
  readonly id = "optimizer";
  readonly name = "Optimizer Agent";

  async tick(ctx: AgentContext): Promise<AgentTickResult> {
    const { config, orchestrator } = ctx;
    const actions: Array<{ actionType: string; outcome: string }> = [];
    const governanceProfile = automationLevelToProfile(config.automationLevel);

    // Step 1: Observe — fetch current metrics for all managed accounts
    const campaigns: Array<{
      id: string;
      name: string;
      metrics: Record<string, number>;
      budget: number;
      status: string;
    }> = [];

    for (const accountId of config.adAccountIds) {
      try {
        const proposeResult = await orchestrator.resolveAndPropose({
          actionType: "digital-ads.snapshot.fetch",
          parameters: { adAccountId: accountId },
          principalId: config.principalId,
          cartridgeId: "digital-ads",
          entityRefs: [],
          message: `Agent optimizer: fetch snapshot for ${accountId}`,
          organizationId: config.organizationId,
        });

        if ("denied" in proposeResult && !proposeResult.denied && proposeResult.envelope) {
          const execResult = await orchestrator.executeApproved(proposeResult.envelope.id);
          if (execResult.success && execResult.data) {
            const snapCampaigns = execResult.data as Array<{
              id: string;
              name: string;
              metrics: Record<string, number>;
              budget: number;
              status: string;
            }>;
            campaigns.push(...snapCampaigns);
          }
        }
        actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "observed" });
      } catch {
        actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "error" });
      }
    }

    if (campaigns.length === 0) {
      const summary = "No campaign data available. Skipping optimization.";
      await this.notify(ctx, summary);
      return { agentId: this.id, actions, summary };
    }

    // Step 2: Decide — run optimization pass
    const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE" || c.status === "active");

    const targets: Record<string, number> = {};
    if (config.targets.cpa) targets["cpa"] = config.targets.cpa;
    if (config.targets.roas) targets["roas"] = config.targets.roas;

    // Compute optimization adjustments inline (same logic as auto-optimizer)
    const adjustments = this.computeAdjustments(
      activeCampaigns,
      targets,
      config.targets.dailyBudgetCap,
    );

    if (adjustments.length === 0) {
      const summary = `Optimization check: ${activeCampaigns.length} campaign(s) performing within range. No adjustments needed.`;
      await this.notify(ctx, summary);
      return { agentId: this.id, actions, summary };
    }

    // Step 3: Act — propose each adjustment through governance
    let executed = 0;
    let pendingApproval = 0;
    let denied = 0;

    for (const adj of adjustments) {
      const actionType = "digital-ads.campaign.updateBudget";

      try {
        const proposeResult = await orchestrator.resolveAndPropose({
          actionType,
          parameters: {
            campaignId: adj.entityId,
            entityId: adj.entityId,
            budget: adj.newValue,
            rationale: adj.rationale,
          },
          principalId: config.principalId,
          cartridgeId: "digital-ads",
          entityRefs: [],
          message: `Agent optimizer: ${adj.action} for campaign ${adj.entityId}`,
          organizationId: config.organizationId,
        });

        if ("denied" in proposeResult && proposeResult.denied) {
          denied++;
          actions.push({ actionType, outcome: "denied" });
          continue;
        }

        if ("approvalRequest" in proposeResult && proposeResult.approvalRequest) {
          pendingApproval++;
          actions.push({ actionType, outcome: "pending_approval" });
          continue;
        }

        // Auto-approved — execute
        if ("envelope" in proposeResult && proposeResult.envelope) {
          const execResult = await orchestrator.executeApproved(proposeResult.envelope.id);
          if (execResult.success) {
            executed++;
            actions.push({ actionType, outcome: "executed" });
          } else {
            actions.push({ actionType, outcome: "error" });
          }
        }
      } catch {
        actions.push({ actionType, outcome: "error" });
      }
    }

    const summary = [
      `Optimization complete (${governanceProfile} mode):`,
      `${activeCampaigns.length} campaign(s) analyzed, ${adjustments.length} adjustment(s) proposed.`,
      executed > 0 ? `${executed} executed.` : null,
      pendingApproval > 0 ? `${pendingApproval} awaiting approval.` : null,
      denied > 0 ? `${denied} denied.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    await this.notify(ctx, summary);

    return { agentId: this.id, actions, summary };
  }

  private computeAdjustments(
    campaigns: Array<{ id: string; metrics: Record<string, number>; budget: number }>,
    targets: Record<string, number>,
    dailyBudgetCap?: number,
  ): Array<{
    entityId: string;
    action: string;
    previousValue: number;
    newValue: number;
    rationale: string;
  }> {
    const MAX_ADJUSTMENT_RATIO = 0.3;
    const UNDERPERFORM_ROAS_THRESHOLD = 0.8;

    if (campaigns.length === 0) return [];

    const scored = campaigns.map((c) => ({
      ...c,
      score: this.performanceScore(c.metrics, targets),
    }));
    scored.sort((a, b) => b.score - a.score);

    const medianScore = scored[Math.floor(scored.length / 2)]?.score ?? 0;
    const adjustments: Array<{
      entityId: string;
      action: string;
      previousValue: number;
      newValue: number;
      rationale: string;
    }> = [];

    let totalImpact = 0;

    for (const campaign of scored) {
      // Enforce daily budget cap
      if (dailyBudgetCap && Math.abs(totalImpact) >= dailyBudgetCap) break;

      const roas = campaign.metrics["roas"] ?? campaign.metrics["ROAS"] ?? 0;
      const targetRoas = targets["roas"] ?? targets["ROAS"] ?? 1;

      if (campaign.score < medianScore && roas < targetRoas * UNDERPERFORM_ROAS_THRESHOLD) {
        const reduction = Math.min(campaign.budget * MAX_ADJUSTMENT_RATIO, campaign.budget * 0.5);
        const newBudget = Math.round((campaign.budget - reduction) * 100) / 100;

        adjustments.push({
          entityId: campaign.id,
          action: "decrease_budget",
          previousValue: campaign.budget,
          newValue: newBudget,
          rationale: `ROAS ${roas.toFixed(2)} below ${(targetRoas * UNDERPERFORM_ROAS_THRESHOLD).toFixed(2)} threshold.`,
        });
        totalImpact += reduction;
      } else if (campaign.score > medianScore * 1.2) {
        const increase = campaign.budget * MAX_ADJUSTMENT_RATIO * 0.5;
        const newBudget = Math.round((campaign.budget + increase) * 100) / 100;

        adjustments.push({
          entityId: campaign.id,
          action: "increase_budget",
          previousValue: campaign.budget,
          newValue: newBudget,
          rationale: `Performance score ${campaign.score.toFixed(2)} exceeds median by 20%+.`,
        });
        totalImpact += increase;
      }
    }

    return adjustments;
  }

  private performanceScore(
    metrics: Record<string, number>,
    targets: Record<string, number>,
  ): number {
    const keys = Object.keys(targets);
    if (keys.length === 0) return 1.0;

    let total = 0;
    let count = 0;

    for (const key of keys) {
      const target = targets[key]!;
      const actual = metrics[key] ?? 0;
      if (target === 0) continue;

      const isCost = key.toLowerCase().includes("cpa") || key.toLowerCase().includes("cpc");
      total += isCost ? target / Math.max(actual, 0.01) : actual / target;
      count++;
    }

    return count > 0 ? total / count : 1.0;
  }

  private async notify(ctx: AgentContext, summary: string): Promise<void> {
    try {
      await ctx.notifier.sendProactive(
        ctx.config.notificationChannel.chatId,
        ctx.config.notificationChannel.type,
        summary,
      );
    } catch {
      // Non-critical — log but don't fail the tick
    }
  }
}
