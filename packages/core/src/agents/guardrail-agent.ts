// ---------------------------------------------------------------------------
// Guardrail Agent — Ad account compliance & safety monitoring
// ---------------------------------------------------------------------------
// Runs on the same schedule as MonitorAgent. Evaluates campaign data against
// a set of configurable guardrail rules covering spend limits, policy
// compliance, anomaly detection, and naming conventions. When violations are
// found it proposes corrective actions through governance and sends a
// formatted violation report to the business owner.
// ---------------------------------------------------------------------------

import type { AdsAgent, AgentContext, AgentTickResult } from "./types.js";
import type { AdsOperatorConfig } from "@switchboard/schemas";

// ── Guardrail data types ──────────────────────────────────────────────────

/** Campaign-level data supplied to guardrail rule evaluators. */
export interface CampaignGuardrailData {
  id: string;
  name: string;
  spend: number;
  budget: number;
  conversions: number;
  impressions: number;
  clicks: number;
  ctr: number;
  status: string;
}

/**
 * A single violation detected by a guardrail rule.
 *
 * `autoCorrect` indicates whether the agent should attempt to fix the issue
 * automatically (e.g. pause a critically overspending campaign).
 */
export interface GuardrailViolation {
  ruleId: string;
  severity: "info" | "warning" | "critical";
  campaignId: string;
  campaignName: string;
  message: string;
  /** Whether the agent should auto-fix this violation. */
  autoCorrect: boolean;
}

/** A guardrail rule that evaluates campaigns and returns any violations. */
export interface GuardrailRule {
  id: string;
  name: string;
  evaluate: (campaigns: CampaignGuardrailData[], config: AdsOperatorConfig) => GuardrailViolation[];
}

// ── Default guardrail rules ───────────────────────────────────────────────

/**
 * Built-in guardrail rules shipped with the agent.
 *
 * 1. **spend_cap** — critical if spend > 130% of budget, warning if > 110%
 * 2. **zero_conversion_spend** — warning if spend > $50 with zero conversions
 * 3. **ctr_anomaly** — warning if CTR < 0.5%
 * 4. **naming_convention** — info if name lacks the account ID prefix
 */
export const DEFAULT_GUARDRAIL_RULES: GuardrailRule[] = [
  // ── 1. Spend cap enforcement ──────────────────────────────────────────
  {
    id: "spend_cap",
    name: "Spend cap enforcement",
    evaluate: (campaigns) => {
      const violations: GuardrailViolation[] = [];

      for (const c of campaigns) {
        if (c.budget <= 0) continue;
        const ratio = c.spend / c.budget;

        if (ratio > 1.3) {
          violations.push({
            ruleId: "spend_cap",
            severity: "critical",
            campaignId: c.id,
            campaignName: c.name,
            message:
              `Campaign "${c.name}" spend $${c.spend.toFixed(2)} is ` +
              `${Math.round(ratio * 100)}% of budget ($${c.budget.toFixed(2)}). ` +
              `Exceeds 130% threshold.`,
            autoCorrect: true,
          });
        } else if (ratio > 1.1) {
          violations.push({
            ruleId: "spend_cap",
            severity: "warning",
            campaignId: c.id,
            campaignName: c.name,
            message:
              `Campaign "${c.name}" spend $${c.spend.toFixed(2)} is ` +
              `${Math.round(ratio * 100)}% of budget ($${c.budget.toFixed(2)}). ` +
              `Exceeds 110% threshold.`,
            autoCorrect: false,
          });
        }
      }

      return violations;
    },
  },

  // ── 2. Zero-conversion spend ──────────────────────────────────────────
  {
    id: "zero_conversion_spend",
    name: "Zero-conversion spend",
    evaluate: (campaigns) => {
      const violations: GuardrailViolation[] = [];

      for (const c of campaigns) {
        if (c.spend > 50 && c.conversions === 0) {
          violations.push({
            ruleId: "zero_conversion_spend",
            severity: "warning",
            campaignId: c.id,
            campaignName: c.name,
            message:
              `Campaign "${c.name}" has spent $${c.spend.toFixed(2)} ` + `with zero conversions.`,
            autoCorrect: false,
          });
        }
      }

      return violations;
    },
  },

  // ── 3. CTR anomaly detection ──────────────────────────────────────────
  {
    id: "ctr_anomaly",
    name: "CTR anomaly detection",
    evaluate: (campaigns) => {
      const violations: GuardrailViolation[] = [];

      for (const c of campaigns) {
        // Only flag campaigns with meaningful impression volume
        if (c.impressions < 100) continue;

        if (c.ctr < 0.5) {
          violations.push({
            ruleId: "ctr_anomaly",
            severity: "warning",
            campaignId: c.id,
            campaignName: c.name,
            message:
              `Campaign "${c.name}" CTR is ${c.ctr.toFixed(2)}% ` +
              `(below 0.5% threshold). May indicate ad rejection or targeting issue.`,
            autoCorrect: false,
          });
        }
      }

      return violations;
    },
  },

  // ── 4. Naming convention enforcement ──────────────────────────────────
  {
    id: "naming_convention",
    name: "Naming convention enforcement",
    evaluate: (campaigns, config) => {
      const violations: GuardrailViolation[] = [];
      const prefix = config.adAccountIds[0] ?? "";

      if (!prefix) return violations;

      for (const c of campaigns) {
        if (!c.name.includes(prefix)) {
          violations.push({
            ruleId: "naming_convention",
            severity: "info",
            campaignId: c.id,
            campaignName: c.name,
            message: `Campaign "${c.name}" does not contain the account ID prefix "${prefix}".`,
            autoCorrect: false,
          });
        }
      }

      return violations;
    },
  },
];

// ── Guardrail Agent ───────────────────────────────────────────────────────

/**
 * Monitors ad account compliance and safety.
 *
 * Runs on the same schedule as MonitorAgent and checks:
 * - Spend limit compliance
 * - Policy violations (e.g. ads running on paused-automation accounts)
 * - Anomaly detection (e.g. sudden CTR drops)
 * - Naming convention enforcement
 *
 * For critical violations the agent proposes corrective actions (e.g. pause
 * campaign) through the governance layer. All violations are reported via
 * the configured notification channel.
 */
export class GuardrailAgent implements AdsAgent {
  readonly id = "guardrail";
  readonly name = "Guardrail Agent";

  private rules: GuardrailRule[];

  constructor(rules?: GuardrailRule[]) {
    this.rules = rules ?? DEFAULT_GUARDRAIL_RULES;
  }

  async tick(ctx: AgentContext): Promise<AgentTickResult> {
    const { config, orchestrator, notifier } = ctx;
    const actions: Array<{ actionType: string; outcome: string }> = [];

    // ── 1. Observe — fetch campaign snapshots for each account ─────────

    const allCampaigns: CampaignGuardrailData[] = [];

    for (const accountId of config.adAccountIds) {
      try {
        const proposeResult = await orchestrator.resolveAndPropose({
          actionType: "digital-ads.snapshot.fetch",
          parameters: { adAccountId: accountId },
          principalId: config.principalId,
          cartridgeId: "digital-ads",
          entityRefs: [],
          message: `Agent guardrail: fetch compliance snapshot for ${accountId}`,
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

            const guardrailData = this.buildGuardrailData(campaigns);
            allCampaigns.push(...guardrailData);
            actions.push({ actionType: "guardrail.fetch", outcome: "fetched" });
          } else {
            actions.push({ actionType: "guardrail.fetch", outcome: "no_data" });
          }
        } else {
          actions.push({ actionType: "guardrail.fetch", outcome: "denied" });
        }
      } catch {
        actions.push({ actionType: "guardrail.fetch", outcome: "error" });
      }
    }

    if (allCampaigns.length === 0) {
      const summary = "No campaign data available. Skipping guardrail checks.";
      await this.sendReport(ctx, summary);
      return { agentId: this.id, actions, summary };
    }

    // ── 2. Decide — evaluate guardrail rules against snapshot data ─────

    const violations: GuardrailViolation[] = [];

    for (const rule of this.rules) {
      const ruleViolations = rule.evaluate(allCampaigns, config);
      violations.push(...ruleViolations);
    }

    // ── 3. Act — propose corrective actions for auto-correct violations ─

    let corrected = 0;
    let pendingApproval = 0;
    let denied = 0;

    const criticalAutoCorrect = violations.filter(
      (v) => v.autoCorrect && v.severity === "critical",
    );

    for (const violation of criticalAutoCorrect) {
      try {
        const proposeResult = await orchestrator.resolveAndPropose({
          actionType: "digital-ads.campaign.pause",
          parameters: {
            campaignId: violation.campaignId,
            entityId: violation.campaignId,
            rationale: `Guardrail auto-correct: ${violation.message}`,
          },
          principalId: config.principalId,
          cartridgeId: "digital-ads",
          entityRefs: [],
          message: `Agent guardrail: pause campaign ${violation.campaignId} — ${violation.ruleId}`,
          organizationId: config.organizationId,
        });

        if ("denied" in proposeResult && proposeResult.denied) {
          denied++;
          actions.push({ actionType: "guardrail.correct", outcome: "denied" });
          continue;
        }

        if ("approvalRequest" in proposeResult && proposeResult.approvalRequest) {
          pendingApproval++;
          actions.push({ actionType: "guardrail.correct", outcome: "pending_approval" });
          continue;
        }

        if ("envelope" in proposeResult && proposeResult.envelope) {
          const execResult = await orchestrator.executeApproved(proposeResult.envelope.id);
          if (execResult.success) {
            corrected++;
            actions.push({ actionType: "guardrail.correct", outcome: "executed" });
          } else {
            actions.push({ actionType: "guardrail.correct", outcome: "error" });
          }
        }
      } catch {
        actions.push({ actionType: "guardrail.correct", outcome: "error" });
      }
    }

    // ── 4. Report — send formatted violation report ───────────────────

    const reportText = this.formatViolationReport(violations, {
      corrected,
      pendingApproval,
      denied,
    });

    try {
      await notifier.sendProactive(
        config.notificationChannel.chatId,
        config.notificationChannel.type,
        reportText,
      );
      actions.push({ actionType: "guardrail.report", outcome: "sent" });
    } catch {
      actions.push({ actionType: "guardrail.report", outcome: "error" });
    }

    // ── 5. Schedule next tick ─────────────────────────────────────────

    const nextTick = new Date();
    nextTick.setDate(nextTick.getDate() + 1);
    nextTick.setHours(config.schedule.reportCronHour, 0, 0, 0);

    const criticalCount = violations.filter((v) => v.severity === "critical").length;
    const warningCount = violations.filter((v) => v.severity === "warning").length;
    const infoCount = violations.filter((v) => v.severity === "info").length;

    const summary =
      violations.length === 0
        ? `Guardrail check passed. ${allCampaigns.length} campaign(s) compliant.`
        : `Guardrail check: ${violations.length} violation(s) found ` +
          `(${criticalCount} critical, ${warningCount} warning, ${infoCount} info).` +
          (corrected > 0 ? ` ${corrected} auto-corrected.` : "") +
          (pendingApproval > 0 ? ` ${pendingApproval} awaiting approval.` : "") +
          (denied > 0 ? ` ${denied} denied.` : "");

    return {
      agentId: this.id,
      actions,
      summary,
      nextTickAt: nextTick,
    };
  }

  // ── Snapshot builder ──────────────────────────────────────────────────

  /**
   * Transforms raw campaign data into the guardrail-specific format,
   * computing derived metrics like CTR.
   */
  private buildGuardrailData(
    campaigns: Array<{
      id: string;
      name: string;
      metrics: Record<string, number>;
      budget: number;
      status: string;
    }>,
  ): CampaignGuardrailData[] {
    return campaigns
      .filter((c) => c.status === "ACTIVE" || c.status === "active")
      .map((c) => {
        const impressions = c.metrics["impressions"] ?? 0;
        const clicks = c.metrics["clicks"] ?? 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

        return {
          id: c.id,
          name: c.name,
          spend: c.metrics["spend"] ?? 0,
          budget: c.budget,
          conversions: c.metrics["conversions"] ?? 0,
          impressions,
          clicks,
          ctr,
          status: c.status,
        };
      });
  }

  // ── Report formatter ──────────────────────────────────────────────────

  /**
   * Formats violations into a human-readable report grouped by severity.
   */
  private formatViolationReport(
    violations: GuardrailViolation[],
    corrections: { corrected: number; pendingApproval: number; denied: number },
  ): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    const lines: string[] = [`Guardrail Report — ${dateStr}`, ""];

    if (violations.length === 0) {
      lines.push("All campaigns are compliant. No violations detected.");
      return lines.join("\n");
    }

    lines.push(`${violations.length} violation(s) detected:`, "");

    // Group by severity for readability
    const critical = violations.filter((v) => v.severity === "critical");
    const warnings = violations.filter((v) => v.severity === "warning");
    const infos = violations.filter((v) => v.severity === "info");

    if (critical.length > 0) {
      lines.push("CRITICAL:");
      for (const v of critical) {
        lines.push(`  [${v.ruleId}] ${v.message}`);
      }
      lines.push("");
    }

    if (warnings.length > 0) {
      lines.push("WARNING:");
      for (const v of warnings) {
        lines.push(`  [${v.ruleId}] ${v.message}`);
      }
      lines.push("");
    }

    if (infos.length > 0) {
      lines.push("INFO:");
      for (const v of infos) {
        lines.push(`  [${v.ruleId}] ${v.message}`);
      }
      lines.push("");
    }

    // Correction summary
    if (corrections.corrected > 0 || corrections.pendingApproval > 0 || corrections.denied > 0) {
      lines.push("Corrective actions:");
      if (corrections.corrected > 0) {
        lines.push(`  ${corrections.corrected} campaign(s) auto-paused.`);
      }
      if (corrections.pendingApproval > 0) {
        lines.push(`  ${corrections.pendingApproval} pause request(s) awaiting approval.`);
      }
      if (corrections.denied > 0) {
        lines.push(`  ${corrections.denied} pause request(s) denied by governance.`);
      }
    }

    return lines.join("\n");
  }

  // ── Notification helper ───────────────────────────────────────────────

  private async sendReport(ctx: AgentContext, message: string): Promise<void> {
    try {
      await ctx.notifier.sendProactive(
        ctx.config.notificationChannel.chatId,
        ctx.config.notificationChannel.type,
        message,
      );
    } catch {
      // Non-critical — don't fail the tick if notification delivery fails
    }
  }
}
