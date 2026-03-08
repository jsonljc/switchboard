// ---------------------------------------------------------------------------
// Notification Dispatcher — Orchestrates sending alerts to all configured
//                           notification channels
// ---------------------------------------------------------------------------

import type { AnomalyResult, BudgetForecast, PolicyScanResult } from "../alerting/types.js";
import type {
  NotificationChannelConfig,
  NotificationPayload,
  NotificationResult,
  NotificationDispatchResult,
} from "./types.js";
import { WebhookChannel } from "./channels/webhook-channel.js";
import { SlackChannel } from "./channels/slack-channel.js";
import { EmailChannel } from "./channels/email-channel.js";

export class NotificationDispatcher {
  private readonly channels: NotificationChannelConfig[];

  constructor(channels: NotificationChannelConfig[]) {
    this.channels = channels;
  }

  // ---------------------------------------------------------------------------
  // Core dispatch
  // ---------------------------------------------------------------------------

  /**
   * Send a single notification payload to all configured channels.
   * Each channel is attempted independently — a failure in one channel
   * does not prevent delivery to the others.
   */
  async dispatch(payload: NotificationPayload): Promise<NotificationDispatchResult> {
    const results: NotificationResult[] = [];

    for (const channelConfig of this.channels) {
      const result = await this.sendToChannel(channelConfig, payload);
      results.push(result);
    }

    return {
      payload,
      results,
      allSucceeded: results.every((r) => r.success),
    };
  }

  // ---------------------------------------------------------------------------
  // Alert-type-specific dispatchers
  // ---------------------------------------------------------------------------

  /**
   * Convert anomaly detection results into notification payloads and dispatch
   * each one to all configured channels.
   */
  async dispatchAnomalyAlerts(
    accountId: string,
    anomalies: AnomalyResult[],
  ): Promise<NotificationDispatchResult[]> {
    const results: NotificationDispatchResult[] = [];

    for (const anomaly of anomalies) {
      const payload: NotificationPayload = {
        alertType: "anomaly",
        severity: anomaly.severity,
        accountId,
        title: `Anomaly Detected: ${anomaly.metric}`,
        message: anomaly.message,
        details: {
          metric: anomaly.metric,
          currentValue: anomaly.currentValue,
          historicalMean: anomaly.historicalMean,
          historicalStdDev: anomaly.historicalStdDev,
          zScore: anomaly.zScore,
        },
        timestamp: new Date().toISOString(),
      };

      results.push(await this.dispatch(payload));
    }

    return results;
  }

  /**
   * Convert budget forecast results into notification payloads and dispatch.
   * Only forecasts with non-healthy status are dispatched.
   */
  async dispatchBudgetAlerts(
    accountId: string,
    forecasts: BudgetForecast[],
  ): Promise<NotificationDispatchResult[]> {
    const results: NotificationDispatchResult[] = [];

    for (const forecast of forecasts) {
      // Only send notifications for non-healthy forecasts
      if (forecast.status === "healthy") {
        continue;
      }

      const severity = this.budgetStatusToSeverity(forecast.status);

      const payload: NotificationPayload = {
        alertType: "budget_forecast",
        severity,
        accountId,
        title: `Budget Alert: ${forecast.campaignName}`,
        message: forecast.recommendations.join(" "),
        details: {
          campaignId: forecast.campaignId,
          campaignName: forecast.campaignName,
          dailyBudget: forecast.dailyBudget,
          dailySpendRate: forecast.dailySpendRate,
          remainingBudget: forecast.remainingBudget,
          daysUntilExhaustion: forecast.daysUntilExhaustion,
          projectedMonthlySpend: forecast.projectedMonthlySpend,
          status: forecast.status,
        },
        timestamp: new Date().toISOString(),
      };

      results.push(await this.dispatch(payload));
    }

    return results;
  }

  /**
   * Convert a policy scan result into notification payloads and dispatch.
   * Dispatches separate notifications for disapproved ads, policy warnings,
   * and spend limit alerts.
   */
  async dispatchPolicyAlerts(
    accountId: string,
    scanResult: PolicyScanResult,
  ): Promise<NotificationDispatchResult[]> {
    const results: NotificationDispatchResult[] = [];

    // If overall healthy, nothing to send
    if (scanResult.overallHealthy) {
      return results;
    }

    // Disapproved ads — critical
    if (scanResult.disapprovedAds.length > 0) {
      const adSummary = scanResult.disapprovedAds
        .map((ad) => `${ad.adName} (${ad.adId}): ${ad.reason}`)
        .join("; ");

      const payload: NotificationPayload = {
        alertType: "policy_violation",
        severity: "critical",
        accountId,
        title: `${scanResult.disapprovedAds.length} Disapproved Ad(s)`,
        message: `The following ads have been disapproved: ${adSummary}`,
        details: {
          disapprovedCount: scanResult.disapprovedAds.length,
          ads: scanResult.disapprovedAds,
        },
        timestamp: new Date().toISOString(),
      };

      results.push(await this.dispatch(payload));
    }

    // Spend limit approaching — warning
    if (scanResult.spendLimitApproaching) {
      const payload: NotificationPayload = {
        alertType: "policy_violation",
        severity: "warning",
        accountId,
        title: "Account Spend Limit Approaching",
        message:
          scanResult.issues.filter((i) => i.toLowerCase().includes("spend limit")).join(" ") ||
          "Account spend limit is approaching its cap.",
        details: {
          spendLimitApproaching: true,
        },
        timestamp: new Date().toISOString(),
      };

      results.push(await this.dispatch(payload));
    }

    // General policy warnings — info
    if (
      scanResult.policyWarnings.length > 0 &&
      !scanResult.spendLimitApproaching &&
      scanResult.disapprovedAds.length === 0
    ) {
      const warningSummary = scanResult.policyWarnings
        .map((w) => `${w.entityType} ${w.entityId}: ${w.warning}`)
        .join("; ");

      const payload: NotificationPayload = {
        alertType: "policy_violation",
        severity: "info",
        accountId,
        title: `${scanResult.policyWarnings.length} Policy Warning(s)`,
        message: warningSummary,
        details: {
          warningCount: scanResult.policyWarnings.length,
          warnings: scanResult.policyWarnings,
        },
        timestamp: new Date().toISOString(),
      };

      results.push(await this.dispatch(payload));
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async sendToChannel(
    config: NotificationChannelConfig,
    payload: NotificationPayload,
  ): Promise<NotificationResult> {
    switch (config.type) {
      case "webhook": {
        const channel = new WebhookChannel(config);
        return channel.send(payload);
      }
      case "slack": {
        const channel = new SlackChannel(config);
        return channel.send(payload);
      }
      case "email": {
        const channel = new EmailChannel(config);
        return channel.send(payload);
      }
      default: {
        return {
          channelType: (config as NotificationChannelConfig).type,
          success: false,
          error: `Unknown channel type: ${(config as Record<string, unknown>).type}`,
        };
      }
    }
  }

  private budgetStatusToSeverity(
    status: BudgetForecast["status"],
  ): NotificationPayload["severity"] {
    switch (status) {
      case "budget_exhausting":
        return "critical";
      case "overspending":
        return "warning";
      case "underspending":
        return "info";
      default:
        return "info";
    }
  }
}
