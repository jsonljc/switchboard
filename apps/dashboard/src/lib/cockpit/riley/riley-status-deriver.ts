import type { CockpitStatus } from "@/components/cockpit/types";

const WATCHING_WINDOW_MS = 15 * 60 * 1000;

export interface RileyStatusInput {
  halted: boolean;
  hasMetaConnection: boolean;
  hasActiveCampaign: boolean;
  pendingApprovals: number;
  recentActivityAt: Date | null;
  now: Date;
}

/**
 * Riley status derivation for B.1.
 *
 * Order:
 *   1. HALTED
 *   2. IDLE — no Meta Ads Connection (precedence over pending recs)
 *   3. IDLE — Connection exists but no active campaign
 *   4. WAITING — pending recs on connected, active account
 *   5. WATCHING — connected, active, no pending, recent activity (<15min)
 *   6. IDLE — fallback
 *
 * REVIEWING deferred in B.1.
 */
export function deriveRileyStatus(input: RileyStatusInput): CockpitStatus {
  if (input.halted) return "HALTED";
  if (!input.hasMetaConnection) return "IDLE";
  if (!input.hasActiveCampaign) return "IDLE";
  if (input.pendingApprovals > 0) return "WAITING";
  if (input.recentActivityAt) {
    const ageMs = input.now.getTime() - input.recentActivityAt.getTime();
    if (ageMs < WATCHING_WINDOW_MS) return "WATCHING";
  }
  return "IDLE";
}
