// ---------------------------------------------------------------------------
// Alerting action handlers — anomaly detection, budget forecasting,
// policy scanning, and notification dispatch/configuration
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, errMsg } from "./handler-context.js";
import { AnomalyDetector } from "../../alerting/anomaly-detector.js";
import { BudgetForecaster } from "../../alerting/budget-forecaster.js";
import { PolicyScanner } from "../../alerting/policy-scanner.js";
import { NotificationDispatcher } from "../../notifications/notification-dispatcher.js";
import type { NotificationChannelConfig } from "../../notifications/types.js";
import type { AnomalyResult, BudgetForecast, PolicyScanResult } from "../../alerting/types.js";

export const alertingHandlers: Map<string, ActionHandler> = new Map([
  // -----------------------------------------------------------------------
  // READ: alert.anomaly_scan
  // -----------------------------------------------------------------------
  [
    "digital-ads.alert.anomaly_scan",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const detector = new AnomalyDetector();
        const dailyMetrics = (params.dailyMetrics ?? []) as Array<{
          date: string;
          spend: number;
          impressions: number;
          clicks: number;
          conversions: number;
          ctr: number;
          cpm: number;
          cpa: number | null;
        }>;
        if (dailyMetrics.length < 3) {
          return fail(
            "Not enough data for anomaly detection (need at least 3 data points)",
            "validation",
            "Provide at least 3 dailyMetrics data points",
          );
        }
        const anomalies = detector.scan(dailyMetrics);
        return {
          success: true,
          summary: `Anomaly scan: ${anomalies.length} anomal${anomalies.length === 1 ? "y" : "ies"} detected across ${dailyMetrics.length} days`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: anomalies,
        };
      } catch (err) {
        return fail(`Failed to scan anomalies: ${errMsg(err)}`, "alert.anomaly_scan", errMsg(err));
      }
    },
  ],

  // -----------------------------------------------------------------------
  // READ: alert.budget_forecast
  // -----------------------------------------------------------------------
  [
    "digital-ads.alert.budget_forecast",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const forecaster = new BudgetForecaster(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const forecasts = await forecaster.forecast(adAccountId);
        const exhaustingSoon = forecasts.filter(
          (f) => f.daysUntilExhaustion !== null && f.daysUntilExhaustion <= 7,
        );
        return {
          success: true,
          summary: `Budget forecast: ${forecasts.length} campaign(s) analyzed, ${exhaustingSoon.length} exhausting within 7 days`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: forecasts,
        };
      } catch (err) {
        return fail(
          `Failed to forecast budgets: ${errMsg(err)}`,
          "alert.budget_forecast",
          errMsg(err),
        );
      }
    },
  ],

  // -----------------------------------------------------------------------
  // READ: alert.policy_scan
  // -----------------------------------------------------------------------
  [
    "digital-ads.alert.policy_scan",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const scanner = new PolicyScanner(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const scanResult = await scanner.scan(adAccountId);
        return {
          success: true,
          summary: `Policy scan: ${scanResult.disapprovedAds.length} disapproved ad(s), ${scanResult.policyWarnings.length} warning(s)`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: scanResult,
        };
      } catch (err) {
        return fail(`Failed to scan policies: ${errMsg(err)}`, "alert.policy_scan", errMsg(err));
      }
    },
  ],

  // -----------------------------------------------------------------------
  // READ: alert.send_notifications
  // -----------------------------------------------------------------------
  [
    "digital-ads.alert.send_notifications",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        if (ctx.notificationChannels.length === 0) {
          return fail(
            "No notification channels configured",
            "validation",
            "Run digital-ads.alert.configure_notifications first to set up channels.",
          );
        }
        const dispatcher = new NotificationDispatcher(ctx.notificationChannels);
        const accountId = (params.accountId as string) ?? "unknown";
        const alertType = params.alertType as string | undefined;
        const allResults: Array<Record<string, unknown>> = [];

        // Dispatch anomaly alerts if requested or all
        if (!alertType || alertType === "anomaly") {
          const anomalies = (params.anomalies ?? []) as Array<Record<string, unknown>>;
          if (anomalies.length > 0) {
            const results = await dispatcher.dispatchAnomalyAlerts(
              accountId,
              anomalies as unknown as AnomalyResult[],
            );
            allResults.push(
              ...results.map(
                (r) => ({ type: "anomaly", ...r }) as unknown as Record<string, unknown>,
              ),
            );
          }
        }

        // Dispatch budget alerts if requested or all
        if (!alertType || alertType === "budget_forecast") {
          const forecasts = (params.forecasts ?? []) as Array<Record<string, unknown>>;
          if (forecasts.length > 0) {
            const results = await dispatcher.dispatchBudgetAlerts(
              accountId,
              forecasts as unknown as BudgetForecast[],
            );
            allResults.push(
              ...results.map(
                (r) => ({ type: "budget", ...r }) as unknown as Record<string, unknown>,
              ),
            );
          }
        }

        // Dispatch policy alerts if requested or all
        if (!alertType || alertType === "policy_violation") {
          const scanResult = params.scanResult as Record<string, unknown> | undefined;
          if (scanResult) {
            const results = await dispatcher.dispatchPolicyAlerts(
              accountId,
              scanResult as unknown as PolicyScanResult,
            );
            allResults.push(
              ...results.map(
                (r) => ({ type: "policy", ...r }) as unknown as Record<string, unknown>,
              ),
            );
          }
        }

        return {
          success: true,
          summary: `Dispatched ${allResults.length} notification(s) to ${ctx.notificationChannels.length} channel(s)`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: { dispatched: allResults.length, results: allResults },
        };
      } catch (err) {
        return fail(
          `Failed to send notifications: ${errMsg(err)}`,
          "alert.send_notifications",
          errMsg(err),
        );
      }
    },
  ],

  // -----------------------------------------------------------------------
  // WRITE: alert.configure_notifications
  // -----------------------------------------------------------------------
  [
    "digital-ads.alert.configure_notifications",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const channels = params.channels as NotificationChannelConfig[] | undefined;
        if (!channels || !Array.isArray(channels) || channels.length === 0) {
          return fail(
            "Missing or empty channels array",
            "validation",
            "Provide at least one notification channel configuration.",
          );
        }
        // Validate each channel has a type
        for (const ch of channels) {
          if (!ch.type || !["webhook", "slack", "email"].includes(ch.type)) {
            return fail(
              `Invalid channel type: ${(ch as unknown as Record<string, unknown>).type}`,
              "validation",
              "Each channel must have type 'webhook', 'slack', or 'email'.",
            );
          }
        }
        const previousChannels = [...ctx.notificationChannels];
        ctx.setNotificationChannels(channels);
        return {
          success: true,
          summary: `Configured ${channels.length} notification channel(s): ${channels.map((c) => c.type).join(", ")}`,
          externalRefs: {},
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: {
            originalActionId: "",
            originalEnvelopeId: "",
            reverseActionType: "digital-ads.alert.configure_notifications",
            reverseParameters: { channels: previousChannels },
            undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            undoRiskCategory: "low",
            undoApprovalRequired: "none",
          },
          data: { channelCount: channels.length, types: channels.map((c) => c.type) },
        };
      } catch (err) {
        return fail(
          `Failed to configure notifications: ${errMsg(err)}`,
          "alert.configure_notifications",
          errMsg(err),
        );
      }
    },
  ],
]);
