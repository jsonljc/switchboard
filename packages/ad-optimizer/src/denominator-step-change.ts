export interface AccountWindowTotals {
  clicks: number;
  conversions: number;
  spend: number;
}

export interface StepChangeResult {
  suspected: boolean;
  reason: string;
}

const DROP_RATIO = 0.5; // conversion-rate fell to <=50% of prior
const FLATNESS_BAND = 0.2; // while clicks stayed within +/-20%

/**
 * Detect an account-wide conversion-DENOMINATOR step-change: conversion rate
 * (conv/clicks) collapses while clicks/spend stay flat — the signature of an
 * attribution-window or action-type reporting shift (the Jan-2026-class event),
 * NOT a real performance drop. When suspected, the runner abstains on cost-driven
 * actions and surfaces a measurement signal rather than killing campaigns.
 */
export function detectDenominatorStepChange(input: {
  current: AccountWindowTotals;
  previous: AccountWindowTotals;
}): StepChangeResult {
  const { current, previous } = input;
  if (previous.clicks <= 0 || previous.conversions <= 0) {
    return { suspected: false, reason: "insufficient prior baseline" };
  }
  const prevRate = previous.conversions / previous.clicks;
  const curRate = current.clicks > 0 ? current.conversions / current.clicks : 0;
  const clicksFlat = Math.abs(current.clicks - previous.clicks) / previous.clicks <= FLATNESS_BAND;
  const rateCollapsed = curRate <= prevRate * DROP_RATIO;
  const suspected = clicksFlat && rateCollapsed;
  return {
    suspected,
    reason: suspected
      ? `conversion rate fell ${(prevRate ? (1 - curRate / prevRate) * 100 : 0).toFixed(0)}% with flat clicks — suspected denominator/window shift`
      : "no step-change",
  };
}
