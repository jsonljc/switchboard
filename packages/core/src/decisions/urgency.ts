import type { Recommendation } from "../recommendations/types.js";
import type { Decision } from "./types.js";

// Vertical-tuned: $2k cap reflects med spa / beauty / dental LTV bands.
// Botox/fillers $400-1200, hydrafacial $200-500, Invisalign $4-8k.
// $2k captures "moderately significant" without letting one Invisalign rec dominate.
const DOLLAR_CAP = 2_000;
const RISK_FLOOR: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 40,
  high: 60,
};

export function scoreRecommendation(row: Recommendation): number {
  const dollarFactor = Math.min(row.dollarsAtRisk / DOLLAR_CAP, 1);
  const base = row.confidence * dollarFactor * 100;
  const floor = RISK_FLOOR[row.riskLevel];
  return Math.round(Math.max(base, floor));
}

// Handoff row shape (from packages/core/src/handoff/types.ts Handoff).
// Typed minimally here — only the fields the scorer reads.
export interface HandoffLike {
  slaDeadlineAt: Date;
}

export function scoreHandoff(row: HandoffLike): number {
  const hoursUntilSla = (row.slaDeadlineAt.getTime() - Date.now()) / 3_600_000;
  if (hoursUntilSla <= 0) return 100;
  if (hoursUntilSla >= 24) return 30;
  return Math.round(100 - (hoursUntilSla / 24) * 70);
}

// Parked governed approvals block real work (the WorkUnit cannot run until a
// human responds), so they floor by risk and ramp to 100 as expiry approaches.
const PARKED_RISK_FLOOR: Record<"low" | "medium" | "high", number> = {
  low: 45,
  medium: 55,
  high: 70,
};

export interface ParkedApprovalLike {
  expiresAt: Date;
  riskLevel: "low" | "medium" | "high";
}

export function scoreParkedApproval(row: ParkedApprovalLike, nowMs = Date.now()): number {
  const floor = PARKED_RISK_FLOOR[row.riskLevel];
  const hoursUntilExpiry = (row.expiresAt.getTime() - nowMs) / 3_600_000;
  if (hoursUntilExpiry <= 0) return 100;
  if (hoursUntilExpiry >= 24) return floor;
  return Math.round(100 - (hoursUntilExpiry / 24) * (100 - floor));
}

export const decisionSortComparator = (a: Decision, b: Decision): number => {
  if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
  return +a.createdAt - +b.createdAt; // older first as tiebreaker
};
