// ---------------------------------------------------------------------------
// Pacing action handlers — flight management & pacing checks
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, errMsg } from "./handler-context.js";
import { PacingMonitor } from "../../pacing/pacing-monitor.js";

export const pacingHandlers: Map<string, ActionHandler> = new Map([
  // -----------------------------------------------------------------------
  // READ: pacing.check
  // -----------------------------------------------------------------------
  [
    "digital-ads.pacing.check",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const flightId = String(params.flightId ?? "");
        const flight = ctx.flightManager.getFlight(flightId);
        if (!flight) {
          return fail(
            `Flight plan not found: ${flightId}`,
            "pacing.check",
            "No flight plan with that ID",
          );
        }
        if (!ctx.apiConfig) return ctx.noApiConfigResult();
        const pacingMonitor = new PacingMonitor(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const status = await pacingMonitor.checkPacing(flight);
        return {
          success: true,
          summary: `Pacing check: ${status.status} (${(status.pacingRatio * 100).toFixed(1)}% of planned), ${status.daysRemaining} days remaining`,
          externalRefs: { flightId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: status,
        };
      } catch (err) {
        return fail(`Failed to check pacing: ${errMsg(err)}`, "pacing.check", errMsg(err));
      }
    },
  ],

  // -----------------------------------------------------------------------
  // WRITE: pacing.create_flight
  // -----------------------------------------------------------------------
  [
    "digital-ads.pacing.create_flight",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const flight = ctx.flightManager.createFlight({
          name: String(params.name ?? ""),
          campaignId: String(params.campaignId ?? ""),
          startDate: String(params.startDate ?? ""),
          endDate: String(params.endDate ?? ""),
          totalBudget: Number(params.totalBudget ?? 0),
          pacingCurve: (params.pacingCurve as "even" | "front-loaded" | "back-loaded") ?? undefined,
        });
        return {
          success: true,
          summary: `Created flight plan "${flight.name}" (${flight.id}) for campaign ${flight.campaignId}: $${flight.totalBudget} from ${flight.startDate} to ${flight.endDate}`,
          externalRefs: { flightId: flight.id },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: flight,
        };
      } catch (err) {
        return fail(
          `Failed to create flight plan: ${errMsg(err)}`,
          "pacing.create_flight",
          errMsg(err),
        );
      }
    },
  ],

  // -----------------------------------------------------------------------
  // WRITE: pacing.auto_adjust
  // -----------------------------------------------------------------------
  [
    "digital-ads.pacing.auto_adjust",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const flightId = String(params.flightId ?? "");
        const flight = ctx.flightManager.getFlight(flightId);
        if (!flight) {
          return fail(
            `Flight plan not found: ${flightId}`,
            "pacing.auto_adjust",
            "No flight plan with that ID",
          );
        }
        if (!ctx.apiConfig) return ctx.noApiConfigResult();
        const pacingMonitor = new PacingMonitor(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const pacingStatus = await pacingMonitor.checkPacing(flight);
        const adjustment = pacingMonitor.calculateAdjustment(pacingStatus);
        return {
          success: true,
          summary: `Pacing auto-adjust for "${flight.name}": ${pacingStatus.status}, recommended daily budget $${adjustment.recommendedDailyBudget.toFixed(2)}`,
          externalRefs: { flightId, campaignId: flight.campaignId },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: {
            originalActionId: "",
            originalEnvelopeId: "",
            reverseActionType: "digital-ads.campaign.adjust_budget",
            reverseParameters: {
              campaignId: flight.campaignId,
              newBudget: adjustment.currentDailyBudget,
            },
            undoExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            undoRiskCategory: "high",
            undoApprovalRequired: "standard",
          },
          data: { status: pacingStatus, adjustment },
        };
      } catch (err) {
        return fail(
          `Failed to auto-adjust pacing: ${errMsg(err)}`,
          "pacing.auto_adjust",
          errMsg(err),
        );
      }
    },
  ],
]);
