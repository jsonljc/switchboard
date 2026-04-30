"use client";

import { consoleFixture, type ConsoleData } from "./console-data";

/**
 * Single swap-point for backend wiring.
 *
 * Today: returns a static fixture so the UI can be reviewed end-to-end.
 *
 * Tomorrow: this hook composes real data from existing hooks
 * (`useDashboardOverview`, `useEscalations`, `useAudit`, `useOrgConfig`,
 * `useAdOptimizerAudit`, `useCreativeJobs`, …) and maps them into
 * `ConsoleData`. View components do not change.
 *
 * Fields the backend does not yet expose (per "Console as dashboard"
 * gap analysis) — these stay synthesized client-side or hidden until the
 * schema is extended:
 *   - per-agent today-stats (`14 replied`, `$842 spent`, `3 in flight`)
 *   - aggregated cross-deployment ad-set rows (Nova panel)
 *   - approval-gate stage progress + countdown
 *   - recommendation confidence + savings estimate
 *   - agent attribution on activity rows
 */
export function useConsoleData(): { data: ConsoleData; isLoading: boolean; error: null } {
  return { data: consoleFixture, isLoading: false, error: null };
}
