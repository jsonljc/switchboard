// ---------------------------------------------------------------------------
// Reporter Agent — Scheduled performance summaries
// ---------------------------------------------------------------------------
// Fetches performance snapshots and sends concise daily/weekly summaries
// to the business owner via their configured notification channel.
// ---------------------------------------------------------------------------

import type { AdsAgent, AgentContext, AgentTickResult } from "./types.js";

export class ReporterAgent implements AdsAgent {
  readonly id = "reporter";
  readonly name = "Reporter Agent";

  async tick(ctx: AgentContext): Promise<AgentTickResult> {
    const { config, orchestrator, notifier } = ctx;
    const actions: Array<{ actionType: string; outcome: string }> = [];

    // Fetch snapshot data for each managed account
    const accountSummaries: Array<{
      accountId: string;
      spend: number;
      cpa: number;
      roas: number;
      conversions: number;
      topCampaign: { name: string; spend: number; conversions: number } | null;
      alerts: string[];
    }> = [];

    for (const accountId of config.adAccountIds) {
      try {
        const proposeResult = await orchestrator.resolveAndPropose({
          actionType: "digital-ads.snapshot.fetch",
          parameters: { adAccountId: accountId },
          principalId: config.principalId,
          cartridgeId: "digital-ads",
          entityRefs: [],
          message: `Agent reporter: fetch daily snapshot for ${accountId}`,
          organizationId: config.organizationId,
        });

        if ("denied" in proposeResult && !proposeResult.denied && proposeResult.envelope) {
          const execResult = await orchestrator.executeApproved(proposeResult.envelope.id);
          if (execResult.success && execResult.data) {
            const campaigns = execResult.data as Array<{
              id: string;
              name: string;
              metrics: Record<string, number>;
              budget: number;
              status: string;
            }>;

            const summary = this.aggregateAccountMetrics(accountId, campaigns, config.targets);
            accountSummaries.push(summary);
            actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "fetched" });
          } else {
            actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "no_data" });
          }
        } else {
          actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "denied" });
        }
      } catch {
        actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "error" });
      }
    }

    // Format and send report
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    let reportText: string;

    if (accountSummaries.length === 0) {
      reportText = `Daily Report -- ${dateStr}\nNo performance data available. Check account connections.`;
    } else {
      reportText = this.formatReport(dateStr, accountSummaries, config);
    }

    try {
      await notifier.sendProactive(
        config.notificationChannel.chatId,
        config.notificationChannel.type,
        reportText,
      );
      actions.push({ actionType: "report.send", outcome: "sent" });
    } catch {
      actions.push({ actionType: "report.send", outcome: "error" });
    }

    // Compute next tick time
    const nextTick = new Date();
    nextTick.setDate(nextTick.getDate() + 1);
    nextTick.setHours(config.schedule.reportCronHour, 0, 0, 0);

    return {
      agentId: this.id,
      actions,
      summary: `Daily report sent for ${accountSummaries.length} account(s).`,
      nextTickAt: nextTick,
    };
  }

  private aggregateAccountMetrics(
    accountId: string,
    campaigns: Array<{
      id: string;
      name: string;
      metrics: Record<string, number>;
      budget: number;
      status: string;
    }>,
    targets: { cpa?: number; roas?: number; dailyBudgetCap?: number },
  ): {
    accountId: string;
    spend: number;
    cpa: number;
    roas: number;
    conversions: number;
    topCampaign: { name: string; spend: number; conversions: number } | null;
    alerts: string[];
  } {
    let totalSpend = 0;
    let totalConversions = 0;
    let totalRevenue = 0;
    const alerts: string[] = [];

    let topCampaign: { name: string; spend: number; conversions: number } | null = null;
    let topConversions = 0;

    const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE" || c.status === "active");

    for (const campaign of activeCampaigns) {
      const spend = campaign.metrics["spend"] ?? 0;
      const conversions = campaign.metrics["conversions"] ?? 0;
      const revenue = campaign.metrics["revenue"] ?? 0;
      const budgetUsed = campaign.budget > 0 ? spend / campaign.budget : 0;

      totalSpend += spend;
      totalConversions += conversions;
      totalRevenue += revenue;

      if (conversions > topConversions) {
        topConversions = conversions;
        topCampaign = { name: campaign.name, spend, conversions };
      }

      // Underspending alert
      if (budgetUsed < 0.5) {
        alerts.push(
          `"${campaign.name}" underspending (${Math.round(budgetUsed * 100)}% of daily budget used)`,
        );
      }
    }

    const cpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    // Target comparison alerts
    if (targets.cpa && cpa > targets.cpa) {
      alerts.push(`CPA $${cpa.toFixed(2)} above target $${targets.cpa.toFixed(2)}`);
    }
    if (targets.roas && roas < targets.roas) {
      alerts.push(`ROAS ${roas.toFixed(1)}x below target ${targets.roas.toFixed(1)}x`);
    }

    return {
      accountId,
      spend: Math.round(totalSpend * 100) / 100,
      cpa: Math.round(cpa * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      conversions: totalConversions,
      topCampaign,
      alerts,
    };
  }

  private formatReport(
    dateStr: string,
    summaries: Array<{
      accountId: string;
      spend: number;
      cpa: number;
      roas: number;
      conversions: number;
      topCampaign: { name: string; spend: number; conversions: number } | null;
      alerts: string[];
    }>,
    config: { targets: { cpa?: number; roas?: number }; schedule: { optimizerCronHour: number } },
  ): string {
    const lines: string[] = [`Daily Report -- ${dateStr}`];

    for (const s of summaries) {
      const cpaStr = config.targets.cpa
        ? `$${s.cpa.toFixed(2)} (target: $${config.targets.cpa.toFixed(2)})`
        : `$${s.cpa.toFixed(2)}`;
      const roasStr = config.targets.roas
        ? `${s.roas.toFixed(1)}x (target: ${config.targets.roas.toFixed(1)}x)`
        : `${s.roas.toFixed(1)}x`;

      lines.push(`Spend: $${s.spend.toFixed(0)} | CPA: ${cpaStr} | ROAS: ${roasStr}`);

      if (s.topCampaign) {
        lines.push(
          `Top: "${s.topCampaign.name}" ($${s.topCampaign.spend.toFixed(0)} spend, ${s.topCampaign.conversions} conversions)`,
        );
      }

      for (const alert of s.alerts) {
        lines.push(`Alert: ${alert}`);
      }
    }

    lines.push(`Next: Optimizer will run at ${config.schedule.optimizerCronHour}:00`);
    return lines.join("\n");
  }
}
