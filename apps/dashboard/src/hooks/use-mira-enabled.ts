"use client";

import { useAgentMission } from "./use-agent-mission";

/**
 * Mira is opt-in per org. Its agent-home endpoint returns non-2xx unless
 * enabled, so the mission probe is the dashboard's source of truth for enablement.
 *   enabled === undefined → still loading (don't flash "not set up")
 */
export function useMiraEnabled(options?: { poll?: boolean }): {
  enabled: boolean | undefined;
  isLoading: boolean;
} {
  // Enablement is effectively static within a session. Consumers that mount on
  // every page (e.g. the header nav) pass { poll: false } so they don't fire a
  // 60s mission poll app-wide just to gate one menu item.
  const m = useAgentMission(
    "mira",
    options?.poll === false ? { refetchInterval: false, staleTime: 5 * 60_000 } : undefined,
  );
  if (m.isLoading) return { enabled: undefined, isLoading: true };
  return { enabled: !m.isError && !!m.data, isLoading: false };
}
