// ---------------------------------------------------------------------------
// Shared handler context — passed to all domain action handlers
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { FlightManager } from "../../pacing/flight-manager.js";
import type { CreativeTestingQueue } from "../../creative/testing-queue.js";
import type { CustomKPIEngine } from "../../core/custom-kpi.js";
import type { GeoExperimentManager } from "../../ab-testing/geo-experiment.js";
import type { AccountMemory } from "../../core/account-memory.js";
import type { SeasonalCalendar } from "../../core/analysis/seasonality.js";
import type { NotificationChannelConfig } from "../../notifications/types.js";
import type { MetaAdsWriteProvider } from "../types.js";

export interface HandlerContext {
  /** Meta Graph API config from session credentials. */
  apiConfig: { baseUrl: string; accessToken: string } | null;
  /** Standard failure result for missing API config. */
  noApiConfigResult: () => ExecuteResult;
  /** Flight management for pacing. */
  flightManager: FlightManager;
  /** Creative A/B testing queue. */
  creativeTestingQueue: CreativeTestingQueue;
  /** Custom KPI engine. */
  kpiEngine: CustomKPIEngine;
  /** Geo-holdout experiment manager. */
  geoExperimentManager: GeoExperimentManager;
  /** Account optimization memory. */
  accountMemory: AccountMemory;
  /** Seasonal events calendar. */
  seasonalCalendar: SeasonalCalendar;
  /** Notification channel configuration. */
  notificationChannels: NotificationChannelConfig[];
  /** Update notification channels (for configure_notifications). */
  setNotificationChannels: (channels: NotificationChannelConfig[]) => void;
  /** Write provider for mutation actions. */
  writeProvider: MetaAdsWriteProvider | null;
  /** Dispatch a write action (for optimization.apply recursive dispatch). */
  dispatchWriteAction: (
    actionType: string,
    parameters: Record<string, unknown>,
  ) => Promise<ExecuteResult>;
}

export type ActionHandler = (
  params: Record<string, unknown>,
  ctx: HandlerContext,
) => Promise<ExecuteResult>;

/** Standard error message extraction. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Standard failure result. */
export function fail(summary: string, step: string, error: string): ExecuteResult {
  return {
    success: false,
    summary,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step, error }],
    durationMs: 0,
    undoRecipe: null,
  };
}

/** Standard success result with data. */
export function success(
  summary: string,
  data: unknown,
  startTime: number,
  opts?: {
    externalRefs?: Record<string, string>;
    rollbackAvailable?: boolean;
    undoRecipe?: ExecuteResult["undoRecipe"];
    partialFailures?: Array<{ step: string; error: string }>;
  },
): ExecuteResult {
  return {
    success: true,
    summary,
    externalRefs: opts?.externalRefs ?? {},
    rollbackAvailable: opts?.rollbackAvailable ?? false,
    partialFailures: opts?.partialFailures ?? [],
    durationMs: Date.now() - startTime,
    undoRecipe: opts?.undoRecipe ?? null,
    data,
  };
}
