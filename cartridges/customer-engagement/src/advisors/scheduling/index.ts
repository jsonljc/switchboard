// ---------------------------------------------------------------------------
// Scheduling Advisors (4 advisors)
// ---------------------------------------------------------------------------

import type { JourneyFindingAdvisor } from "../types.js";
import { percentChange } from "../../core/analysis/significance.js";

/**
 * Booking Conversion — tracks consultation booking rate.
 */
export const bookingRateAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  dropoffs,
  _current,
  _previous,
) => {
  const bookingDropoff = dropoffs.find(
    (d) => d.fromStage === "Qualified" && d.toStage === "Consultation Booked",
  );

  if (!bookingDropoff) return [];

  if (bookingDropoff.currentRate < 0.3) {
    return [
      {
        severity: "warning",
        stage: "booking_rate",
        message: `Booking conversion rate is ${(bookingDropoff.currentRate * 100).toFixed(1)}% — below 30% threshold.`,
        recommendation:
          "Simplify booking process. Offer online self-scheduling. Reduce time from qualification to booking.",
      },
    ];
  }

  if (bookingDropoff.deltaPercent < -15) {
    return [
      {
        severity: "info",
        stage: "booking_rate",
        message: `Booking conversion dropped ${bookingDropoff.deltaPercent.toFixed(1)}% PoP.`,
        recommendation: "Check appointment availability and booking friction points.",
      },
    ];
  }

  return [];
};

/**
 * No-Show Rate — tracks appointment no-shows.
 */
export const noShowAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
) => {
  const currentRate = current.aggregates.noShowRate;

  if (currentRate > 0.2) {
    return [
      {
        severity: "critical",
        stage: "no_show_rate",
        message: `No-show rate is ${(currentRate * 100).toFixed(1)}% — exceeding 20% threshold.`,
        recommendation:
          "Implement multi-touch reminders (24hr + 2hr before). Require confirmation. Consider deposit policy.",
      },
    ];
  }

  if (currentRate > 0.1) {
    return [
      {
        severity: "warning",
        stage: "no_show_rate",
        message: `No-show rate is ${(currentRate * 100).toFixed(1)}%.`,
        recommendation: "Add SMS reminders 24 hours and 2 hours before appointments.",
      },
    ];
  }

  return [];
};

/**
 * Cancellation Pattern — tracks cancellation trends.
 */
export const cancellationPatternAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  const currentRate = current.aggregates.cancellationRate;
  const previousRate = previous.aggregates.cancellationRate;
  const delta = percentChange(currentRate, previousRate);

  if (currentRate > 0.15 && delta > 20) {
    return [
      {
        severity: "warning",
        stage: "cancellation_pattern",
        message: `Cancellation rate is ${(currentRate * 100).toFixed(1)}% (up ${delta.toFixed(1)}% PoP).`,
        recommendation:
          "Survey cancelling patients. Review scheduling flexibility and cancellation policy.",
      },
    ];
  }

  return [];
};

/**
 * Slot Utilization — tracks how full the schedule is.
 */
export const slotUtilizationAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
) => {
  const booked = current.stages["consultations_booked"]?.count ?? 0;
  const completed = current.stages["consultations_completed"]?.count ?? 0;

  if (booked > 0 && completed / booked < 0.7) {
    return [
      {
        severity: "info",
        stage: "slot_utilization",
        message: `Only ${((completed / booked) * 100).toFixed(1)}% of booked consultations were completed.`,
        recommendation:
          "Review cancellation and no-show rates. Implement waitlist for cancelled slots.",
      },
    ];
  }

  return [];
};
