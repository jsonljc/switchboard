import type { CostBreakdown } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import { formatCurrencyUSD } from "./period-helpers.js";

export const SDR_MONTHLY_USD = 5000;
export const AGENCY_MONTHLY_USD = 3000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function computeCostVsValue(
  ctx: RollupContext,
  planMonthlyUSD: number,
): Promise<{ cost: CostBreakdown; costNarrative: string }> {
  const daysInWindow = (ctx.current.end.getTime() - ctx.current.start.getTime()) / MS_PER_DAY;
  const prorationFactor = daysInWindow / 30;

  const paid = planMonthlyUSD * prorationFactor;
  const alt = (SDR_MONTHLY_USD + AGENCY_MONTHLY_USD) * prorationFactor;
  const saving = alt - paid;

  let costNarrative: string;
  if (planMonthlyUSD === 0) {
    costNarrative =
      `No active subscription detected. ` +
      `A comparable in-house stack (junior SDR + ad agency retainer) ` +
      `would run ~${formatCurrencyUSD(alt)} for this period.`;
  } else {
    costNarrative =
      `Switchboard cost is estimated from your subscription plan at ~${formatCurrencyUSD(paid)} for this period. ` +
      `A comparable in-house stack would run ~${formatCurrencyUSD(alt)}, ` +
      `saving ~${formatCurrencyUSD(saving)}. ` +
      `Actual invoice amounts may vary.`;
  }

  return {
    cost: {
      paid: Math.round(paid * 100) / 100,
      alt: Math.round(alt * 100) / 100,
      saving: Math.round(saving * 100) / 100,
    },
    costNarrative,
  };
}
