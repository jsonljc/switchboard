// ---------------------------------------------------------------------------
// Revenue Advisors (4 advisors)
// ---------------------------------------------------------------------------

import type { JourneyFindingAdvisor } from "../types.js";
import { percentChange } from "../../core/analysis/significance.js";

/**
 * Conversion Rate — consultation-to-treatment conversion.
 */
export const conversionRateAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  dropoffs,
  _current,
  _previous,
) => {
  const convDropoff = dropoffs.find(
    (d) => d.fromStage === "Consultation Completed" && d.toStage === "Service Proposed",
  );

  if (!convDropoff) return [];

  if (convDropoff.currentRate < 0.5 && convDropoff.deltaPercent < -10) {
    return [
      {
        severity: "warning",
        stage: "conversion_rate",
        message: `Consultation-to-treatment conversion is ${(convDropoff.currentRate * 100).toFixed(1)}% (down ${convDropoff.deltaPercent.toFixed(1)}% PoP).`,
        recommendation:
          "Review consultation scripts. Train staff on treatment presentation techniques.",
      },
    ];
  }

  return [];
};

/**
 * ATV Trends — average treatment value trends.
 */
export const atvTrendAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  const currentATV = current.aggregates.averageServiceValue;
  const previousATV = previous.aggregates.averageServiceValue;

  if (currentATV === 0 && previousATV === 0) return [];

  const delta = percentChange(currentATV, previousATV);

  if (delta < -15) {
    return [
      {
        severity: "warning",
        stage: "atv_trend",
        message: `Average treatment value dropped ${delta.toFixed(1)}% ($${previousATV.toFixed(0)} → $${currentATV.toFixed(0)}).`,
        recommendation:
          "Review treatment mix. Consider bundling services or introducing premium packages.",
      },
    ];
  }

  if (delta > 20) {
    return [
      {
        severity: "healthy",
        stage: "atv_trend",
        message: `Average treatment value increased ${delta.toFixed(1)}% ($${previousATV.toFixed(0)} → $${currentATV.toFixed(0)}).`,
        recommendation: null,
      },
    ];
  }

  return [];
};

/**
 * Upsell Success — treatment acceptance beyond initial proposal.
 */
export const upsellAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  dropoffs,
  _current,
  _previous,
) => {
  const propToAccept = dropoffs.find(
    (d) => d.fromStage === "Service Proposed" && d.toStage === "Service Accepted",
  );

  if (!propToAccept) return [];

  if (propToAccept.currentRate > 0.8) {
    return [
      {
        severity: "healthy",
        stage: "upsell",
        message: `Treatment acceptance rate is ${(propToAccept.currentRate * 100).toFixed(1)}% — strong proposal-to-acceptance conversion.`,
        recommendation: null,
      },
    ];
  }

  if (propToAccept.currentRate < 0.5) {
    return [
      {
        severity: "warning",
        stage: "upsell",
        message: `Treatment acceptance rate is only ${(propToAccept.currentRate * 100).toFixed(1)}%.`,
        recommendation:
          "Review pricing transparency. Offer financing options. Improve service plan presentations.",
      },
    ];
  }

  return [];
};

/**
 * LTV Cohort Trend — tracks lifetime value trends across contact cohorts.
 */
export const ltvTrendAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  const currentRevenue = current.aggregates.totalRevenue;
  const previousRevenue = previous.aggregates.totalRevenue;
  const currentContacts = current.totalContacts;
  const previousContacts = previous.totalContacts;

  if (currentContacts === 0 || previousContacts === 0) return [];

  const currentRevenuePerContact = currentRevenue / currentContacts;
  const previousRevenuePerContact = previousRevenue / previousContacts;
  const delta = percentChange(currentRevenuePerContact, previousRevenuePerContact);

  if (delta < -20) {
    return [
      {
        severity: "warning",
        stage: "ltv_trend",
        message: `Revenue per contact dropped ${delta.toFixed(1)}% ($${previousRevenuePerContact.toFixed(0)} → $${currentRevenuePerContact.toFixed(0)}).`,
        recommendation:
          "Analyze contact cohort retention. Implement win-back campaigns for dormant contacts.",
      },
    ];
  }

  return [];
};
