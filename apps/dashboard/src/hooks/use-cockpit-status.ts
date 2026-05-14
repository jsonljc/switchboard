// apps/dashboard/src/hooks/use-cockpit-status.ts
"use client";

import { useMemo } from "react";
import type { CockpitStatus } from "@/components/cockpit/types";

export interface DeriveStatusInput {
  halted: boolean;
  pendingApprovals: number;
  recentActivityAt: Date | null;
  inQuietHours: boolean;
  now: Date;
}

const WORKING_WINDOW_MS = 15 * 60_000;

export function deriveAlexStatusA1(input: DeriveStatusInput): CockpitStatus {
  if (input.halted) return "HALTED";
  if (input.pendingApprovals > 0) return "WAITING";
  if (
    input.recentActivityAt &&
    input.now.getTime() - input.recentActivityAt.getTime() < WORKING_WINDOW_MS
  ) {
    return "WORKING";
  }
  return "IDLE";
}

export interface CockpitStatusHookInput {
  halted: boolean;
  pendingApprovals: number;
  recentActivityAt: Date | null;
  inQuietHours?: boolean;
  /**
   * Current time. Pass a state-driven clock so the WORKING window
   * transitions cleanly to IDLE after the 15-minute boundary even
   * when the upstream activity-recency timestamp is stable.
   * Defaults to `new Date()` (only correct for stories/tests).
   */
  now?: Date;
}

export function useCockpitStatusAlex(input: CockpitStatusHookInput): CockpitStatus {
  const now = input.now ?? new Date();
  return useMemo(
    () =>
      deriveAlexStatusA1({
        halted: input.halted,
        pendingApprovals: input.pendingApprovals,
        recentActivityAt: input.recentActivityAt,
        inQuietHours: input.inQuietHours ?? false,
        now,
      }),
    [
      input.halted,
      input.pendingApprovals,
      input.recentActivityAt?.getTime(),
      input.inQuietHours,
      now.getTime(),
    ],
  );
}
