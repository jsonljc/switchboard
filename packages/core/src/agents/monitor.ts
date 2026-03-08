// ---------------------------------------------------------------------------
// Monitor Agent — Proactive performance monitoring with daily/weekly digests
// ---------------------------------------------------------------------------
// Runs on a cron schedule: daily at reportCronHour (9am default) and
// weekly on Mondays. Pulls campaign performance, computes outcome-based
// metrics, evaluates alert conditions, and sends formatted digests to
// the business owner via their configured notification channel.
// ---------------------------------------------------------------------------

import type { AdsAgent, AgentContext, AgentTickResult } from "./types.js";

// ── Alert condition types ───────────────────────────────────────────────────

export interface AlertCondition {
  id: string;
  name: string;
  evaluate: (data: MonitorSnapshot) => AlertResult | null;
}

export interface AlertResult {
  conditionId: string;
  severity: "warning" | "critical";
  message: string;
}

// ── Snapshot types ──────────────────────────────────────────────────────────

export interface CampaignSnapshot {
  id: string;
  name: string;
  spend: number;
  budget: number;
  conversions: number;
  leads: number;
  qualified: number;
  booked: number;
  revenue: number;
  status: string;
}

export interface MonitorSnapshot {
  accountId: string;
  totalSpend: number;
  dailyBudget: number;
  leads: number;
  qualified: number;
  booked: number;
  revenue: number;
  campaigns: CampaignSnapshot[];
  /** Hours since the last lead conversion was recorded. */
  hoursSinceLastLead: number | null;
}

// ── Default alert conditions ────────────────────────────────────────────────

export const DEFAULT_ALERT_CONDITIONS: AlertCondition[] = [
  {
    id: "overspend",
    name: "Budget overspend",
    evaluate: (data) => {
      if (data.dailyBudget <= 0) return null;
      const ratio = data.totalSpend / data.dailyBudget;
      if (ratio > 1.2) {
        return {
          conditionId: "overspend",
          severity: "critical",
          message: `Spend $${data.totalSpend.toFixed(0)} exceeds 120% of daily budget ($${data.dailyBudget.toFixed(0)})`,
        };
      }
      return null;
    },
  },
  {
    id: "cpl_spike",
    name: "CPL spike",
    evaluate: (data) => {
      if (data.leads === 0) return null;
      const cpl = data.totalSpend / data.leads;
      // Alert if CPL > $50 (configurable via custom conditions)
      if (cpl > 50) {
        return {
          conditionId: "cpl_spike",
          severity: "warning",
          message: `Cost per lead $${cpl.toFixed(2)} is elevated`,
        };
      }
      return null;
    },
  },
  {
    id: "no_leads_48h",
    name: "No leads in 48 hours",
    evaluate: (data) => {
      if (data.hoursSinceLastLead !== null && data.hoursSinceLastLead > 48) {
        return {
          conditionId: "no_leads_48h",
          severity: "critical",
          message: `No leads in ${Math.round(data.hoursSinceLastLead)} hours`,
        };
      }
      return null;
    },
  },
  {
    id: "budget_exhaustion",
    name: "Early budget exhaustion",
    evaluate: (data) => {
      if (data.dailyBudget <= 0) return null;
      const ratio = data.totalSpend / data.dailyBudget;
      // Check if any campaign has used >90% of budget
      for (const c of data.campaigns) {
        if (c.budget > 0 && c.spend / c.budget > 0.9 && c.status === "ACTIVE") {
          return {
            conditionId: "budget_exhaustion",
            severity: "warning",
            message: `"${c.name}" has used ${Math.round((c.spend / c.budget) * 100)}% of its budget`,
          };
        }
      }
      // Also check total
      if (ratio > 0.9 && ratio <= 1.2) {
        return {
          conditionId: "budget_exhaustion",
          severity: "warning",
          message: `Total spend $${data.totalSpend.toFixed(0)} is ${Math.round(ratio * 100)}% of daily budget`,
        };
      }
      return null;
    },
  },
];

// ── Monitor Agent ───────────────────────────────────────────────────────────

export class MonitorAgent implements AdsAgent {
  readonly id = "monitor";
  readonly name = "Monitor Agent";

  private alertConditions: AlertCondition[];

  constructor(alertConditions?: AlertCondition[]) {
    this.alertConditions = alertConditions ?? DEFAULT_ALERT_CONDITIONS;
  }

  async tick(ctx: AgentContext): Promise<AgentTickResult> {
    const { config, orchestrator, notifier } = ctx;
    const actions: Array<{ actionType: string; outcome: string }> = [];
    const snapshots: MonitorSnapshot[] = [];

    // ── 1. Fetch campaign performance for each account ──────────────

    for (const accountId of config.adAccountIds) {
      try {
        const proposeResult = await orchestrator.resolveAndPropose({
          actionType: "digital-ads.snapshot.fetch",
          parameters: { adAccountId: accountId },
          principalId: config.principalId,
          cartridgeId: "digital-ads",
          entityRefs: [],
          message: `Agent monitor: fetch performance snapshot for ${accountId}`,
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

            const snapshot = this.buildSnapshot(accountId, campaigns, config.targets);
            snapshots.push(snapshot);
            actions.push({ actionType: "monitor.fetch", outcome: "fetched" });
          } else {
            actions.push({ actionType: "monitor.fetch", outcome: "no_data" });
          }
        } else {
          actions.push({ actionType: "monitor.fetch", outcome: "denied" });
        }
      } catch {
        actions.push({ actionType: "monitor.fetch", outcome: "error" });
      }
    }

    // ── 2. Evaluate alert conditions ────────────────────────────────

    const alerts: AlertResult[] = [];
    for (const snapshot of snapshots) {
      for (const condition of this.alertConditions) {
        const result = condition.evaluate(snapshot);
        if (result) {
          alerts.push(result);
        }
      }
    }

    // ── 3. Determine report type (daily vs weekly) ──────────────────

    const now = new Date();
    const isMonday = now.getDay() === 1;
    const reportText = isMonday
      ? this.formatWeeklyReport(now, snapshots, alerts, config)
      : this.formatDailyReport(now, snapshots, alerts, config);

    // ── 4. Send report ──────────────────────────────────────────────

    try {
      await notifier.sendProactive(
        config.notificationChannel.chatId,
        config.notificationChannel.type,
        reportText,
      );
      actions.push({ actionType: "monitor.report", outcome: "sent" });
    } catch {
      actions.push({ actionType: "monitor.report", outcome: "error" });
    }

    // ── 5. Schedule next tick ───────────────────────────────────────

    const nextTick = new Date();
    nextTick.setDate(nextTick.getDate() + 1);
    nextTick.setHours(config.schedule.reportCronHour, 0, 0, 0);

    return {
      agentId: this.id,
      actions,
      summary: isMonday
        ? `Weekly report sent for ${snapshots.length} account(s). ${alerts.length} alert(s).`
        : `Daily digest sent for ${snapshots.length} account(s). ${alerts.length} alert(s).`,
      nextTickAt: nextTick,
    };
  }

  // ── Snapshot builder ────────────────────────────────────────────────

  private buildSnapshot(
    accountId: string,
    campaigns: Array<{
      id: string;
      name: string;
      metrics: Record<string, number>;
      budget: number;
      status: string;
    }>,
    targets: { dailyBudgetCap?: number },
  ): MonitorSnapshot {
    const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE" || c.status === "active");

    const campaignSnapshots: CampaignSnapshot[] = activeCampaigns.map((c) => ({
      id: c.id,
      name: c.name,
      spend: c.metrics["spend"] ?? 0,
      budget: c.budget,
      conversions: c.metrics["conversions"] ?? 0,
      leads: c.metrics["leads"] ?? c.metrics["conversions"] ?? 0,
      qualified: c.metrics["qualified"] ?? 0,
      booked: c.metrics["booked"] ?? 0,
      revenue: c.metrics["revenue"] ?? 0,
      status: c.status,
    }));

    const totalSpend = campaignSnapshots.reduce((s, c) => s + c.spend, 0);
    const totalLeads = campaignSnapshots.reduce((s, c) => s + c.leads, 0);
    const totalQualified = campaignSnapshots.reduce((s, c) => s + c.qualified, 0);
    const totalBooked = campaignSnapshots.reduce((s, c) => s + c.booked, 0);
    const totalRevenue = campaignSnapshots.reduce((s, c) => s + c.revenue, 0);
    const totalBudget =
      targets.dailyBudgetCap ?? campaignSnapshots.reduce((s, c) => s + c.budget, 0);

    return {
      accountId,
      totalSpend: Math.round(totalSpend * 100) / 100,
      dailyBudget: totalBudget,
      leads: totalLeads,
      qualified: totalQualified,
      booked: totalBooked,
      revenue: totalRevenue,
      campaigns: campaignSnapshots,
      hoursSinceLastLead: null, // Populated by caller if OutcomeTracker is available
    };
  }

  // ── Daily digest formatter ──────────────────────────────────────────

  private formatDailyReport(
    date: Date,
    snapshots: MonitorSnapshot[],
    alerts: AlertResult[],
    config: { targets: { dailyBudgetCap?: number } },
  ): string {
    const dateStr = date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    const lines: string[] = [`\u{1F4CA} Daily Report \u{2014} ${dateStr}`, ""];

    if (snapshots.length === 0) {
      lines.push("No performance data available. Check account connections.");
      return lines.join("\n");
    }

    for (const s of snapshots) {
      const budgetStr = config.targets.dailyBudgetCap
        ? ` / $${config.targets.dailyBudgetCap} daily budget`
        : "";
      lines.push(`Spent: $${s.totalSpend.toFixed(2)}${budgetStr}`);

      const cpl = s.leads > 0 ? s.totalSpend / s.leads : null;
      lines.push(`Leads: ${s.leads}${cpl !== null ? ` (CPL: $${cpl.toFixed(2)})` : ""}`);

      if (s.qualified > 0 || s.leads > 0) {
        const qualRate = s.leads > 0 ? Math.round((s.qualified / s.leads) * 100) : 0;
        lines.push(`Qualified: ${s.qualified} (${qualRate}%)`);
      }

      if (s.booked > 0 || s.qualified > 0) {
        const costPerBooking = s.booked > 0 ? s.totalSpend / s.booked : null;
        lines.push(
          `Booked: ${s.booked}${costPerBooking !== null ? ` (Cost per booking: $${costPerBooking.toFixed(2)})` : ""}`,
        );
      }

      // Top campaign
      const top = this.findTopCampaign(s.campaigns);
      if (top) {
        lines.push("");
        lines.push(`Top campaign: ${top.name}`);
      }

      // Zero-lead campaigns
      const zeroCampaigns = s.campaigns.filter((c) => c.leads === 0 && c.spend > 0);
      for (const zc of zeroCampaigns) {
        lines.push(`\u{26A0}\u{FE0F} "${zc.name}" has 0 leads today. Watching.`);
      }
    }

    // Alerts
    if (alerts.length > 0) {
      lines.push("");
      for (const alert of alerts) {
        const icon = alert.severity === "critical" ? "\u{1F6A8}" : "\u{26A0}\u{FE0F}";
        lines.push(`${icon} ${alert.message}`);
      }
    } else {
      lines.push("");
      lines.push("No action needed. All campaigns healthy.");
    }

    return lines.join("\n");
  }

  // ── Weekly report formatter ─────────────────────────────────────────

  private formatWeeklyReport(
    date: Date,
    snapshots: MonitorSnapshot[],
    alerts: AlertResult[],
    config: { targets: { dailyBudgetCap?: number } },
  ): string {
    const endDate = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - 6);
    const startStr = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const lines: string[] = [`\u{1F4CA} Weekly Report \u{2014} ${startStr}\u{2013}${endDate}`, ""];

    if (snapshots.length === 0) {
      lines.push("No performance data available this week.");
      return lines.join("\n");
    }

    // Aggregate across all accounts
    let totalSpend = 0;
    let totalLeads = 0;
    let totalQualified = 0;
    let totalBooked = 0;
    let totalRevenue = 0;
    const allCampaigns: CampaignSnapshot[] = [];

    for (const s of snapshots) {
      totalSpend += s.totalSpend;
      totalLeads += s.leads;
      totalQualified += s.qualified;
      totalBooked += s.booked;
      totalRevenue += s.revenue;
      allCampaigns.push(...s.campaigns);
    }

    const weeklyBudget = config.targets.dailyBudgetCap ? config.targets.dailyBudgetCap * 7 : null;
    const budgetStr = weeklyBudget !== null ? ` / $${weeklyBudget.toFixed(0)} budget` : "";

    lines.push(`Spent: $${totalSpend.toFixed(0)}${budgetStr}`);

    const qualRate = totalLeads > 0 ? Math.round((totalQualified / totalLeads) * 100) : 0;
    const bookRate = totalQualified > 0 ? Math.round((totalBooked / totalQualified) * 100) : 0;
    lines.push(
      `Leads: ${totalLeads} | Qualified: ${totalQualified} (${qualRate}%) | Booked: ${totalBooked} (${bookRate}%)`,
    );

    const costPerBooking = totalBooked > 0 ? totalSpend / totalBooked : null;
    if (costPerBooking !== null) {
      lines.push(`Cost per booking: $${costPerBooking.toFixed(2)}`);
    }

    if (totalRevenue > 0) {
      lines.push(`Estimated revenue from bookings: ~$${totalRevenue.toLocaleString()}`);
    }

    // Campaign ranking
    if (allCampaigns.length > 0) {
      const sorted = [...allCampaigns]
        .filter((c) => c.booked > 0)
        .sort((a, b) => {
          const cpbA = a.spend / a.booked;
          const cpbB = b.spend / b.booked;
          return cpbA - cpbB;
        });

      if (sorted.length > 0) {
        lines.push("");
        const best = sorted[0]!;
        const bestCpb = best.spend / best.booked;
        lines.push(`\u{1F51D} Best: "${best.name}" \u{2014} $${bestCpb.toFixed(2)}/booking`);

        if (sorted.length > 1) {
          const worst = sorted[sorted.length - 1]!;
          const worstCpb = worst.spend / worst.booked;
          lines.push(
            `\u{2B07}\u{FE0F} Worst: "${worst.name}" \u{2014} $${worstCpb.toFixed(2)}/booking`,
          );

          // Generate budget shift recommendation if there's a meaningful gap
          if (worstCpb > bestCpb * 1.5) {
            const shiftAmount = Math.round(worst.spend * 0.2);
            lines.push("");
            lines.push(
              `\u{1F4A1} Recommendation: Shift $${shiftAmount}/week from ${worst.name} to ${best.name}.`,
            );
          }
        }
      }
    }

    // Alerts
    if (alerts.length > 0) {
      lines.push("");
      for (const alert of alerts) {
        const icon = alert.severity === "critical" ? "\u{1F6A8}" : "\u{26A0}\u{FE0F}";
        lines.push(`${icon} ${alert.message}`);
      }
    }

    return lines.join("\n");
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private findTopCampaign(campaigns: CampaignSnapshot[]): CampaignSnapshot | null {
    let top: CampaignSnapshot | null = null;
    for (const c of campaigns) {
      if (!top || c.leads > top.leads) {
        top = c;
      }
    }
    return top && top.leads > 0 ? top : null;
  }
}
