"use client";

import { useAgentMission } from "./use-agent-mission";

/**
 * Mira is opt-in per org. Its agent-home endpoints 404 unless enabled, so the
 * mission probe is the dashboard's source of truth for enablement.
 *   enabled === undefined → still loading (don't flash "not set up")
 */
export function useMiraEnabled(): { enabled: boolean | undefined; isLoading: boolean } {
  const m = useAgentMission("mira");
  if (m.isLoading) return { enabled: undefined, isLoading: true };
  return { enabled: !m.isError && !!m.data, isLoading: false };
}
