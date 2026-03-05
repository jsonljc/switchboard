// ---------------------------------------------------------------------------
// Qualification Advisors (4 advisors)
// ---------------------------------------------------------------------------

import type { JourneyFindingAdvisor } from "../types.js";
import { percentChange } from "../../core/analysis/significance.js";

/**
 * Lead Quality Rate — tracks the ratio of qualified vs new leads.
 */
export const leadQualityAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  const newLeads = current.stages["new_leads"]?.count ?? 0;
  const qualified = current.stages["qualified_leads"]?.count ?? 0;
  const prevNewLeads = previous.stages["new_leads"]?.count ?? 0;
  const prevQualified = previous.stages["qualified_leads"]?.count ?? 0;

  if (newLeads === 0 && prevNewLeads === 0) return [];

  const currentRate = newLeads > 0 ? qualified / newLeads : 0;
  const previousRate = prevNewLeads > 0 ? prevQualified / prevNewLeads : 0;
  const delta = percentChange(currentRate, previousRate);

  if (currentRate < 0.3 && newLeads > 10) {
    return [
      {
        severity: "warning",
        stage: "qualification",
        message: `Lead quality rate is ${(currentRate * 100).toFixed(1)}% (${qualified}/${newLeads}). Less than 30% of leads are qualifying.`,
        recommendation:
          "Review lead sources and tighten intake criteria to reduce low-quality leads.",
      },
    ];
  }

  if (delta < -20 && prevNewLeads > 10) {
    return [
      {
        severity: "warning",
        stage: "qualification",
        message: `Lead quality rate dropped ${delta.toFixed(1)}% PoP (${(previousRate * 100).toFixed(1)}% → ${(currentRate * 100).toFixed(1)}%).`,
        recommendation: "Investigate changes in lead sources or marketing campaigns.",
      },
    ];
  }

  return [];
};

/**
 * Intent Strength — measures treatment interest indicators.
 */
export const intentStrengthAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  dropoffs,
  _current,
  _previous,
) => {
  const qualifiedDropoff = dropoffs.find(
    (d) => d.fromStage === "Qualified" && d.toStage === "Consultation Booked",
  );

  if (!qualifiedDropoff) return [];

  if (qualifiedDropoff.currentRate < 0.4 && qualifiedDropoff.deltaPercent < -10) {
    return [
      {
        severity: "warning",
        stage: "intent_strength",
        message: `Only ${(qualifiedDropoff.currentRate * 100).toFixed(1)}% of qualified leads are booking consultations (down ${qualifiedDropoff.deltaPercent.toFixed(1)}% PoP).`,
        recommendation:
          "Strengthen follow-up cadence after qualification. Consider offering virtual consultations.",
      },
    ];
  }

  return [];
};

/**
 * Urgency Distribution — flags imbalance in urgency levels.
 */
export const urgencyAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  const currentBooked = current.stages["consultations_booked"]?.count ?? 0;
  const previousBooked = previous.stages["consultations_booked"]?.count ?? 0;
  const delta = percentChange(currentBooked, previousBooked);

  // Flag if consultation bookings are declining despite stable lead volume
  const currentLeads = current.stages["new_leads"]?.count ?? 0;
  const previousLeads = previous.stages["new_leads"]?.count ?? 0;
  const leadsDelta = percentChange(currentLeads, previousLeads);

  if (delta < -15 && leadsDelta > -5 && currentLeads > 10) {
    return [
      {
        severity: "info",
        stage: "urgency",
        message: `Consultation bookings dropped ${delta.toFixed(1)}% despite stable lead volume (${leadsDelta.toFixed(1)}% change).`,
        recommendation: "Review urgency messaging and appointment availability windows.",
      },
    ];
  }

  return [];
};

/**
 * Medical History Flag Rate — monitors medical clearance requirements.
 */
export const medicalFlagAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
) => {
  // This advisor is informational — tracks how often medical history
  // is flagging leads for additional review
  const proposed = current.stages["services_proposed"]?.count ?? 0;
  const accepted = current.stages["services_accepted"]?.count ?? 0;

  if (proposed > 0 && accepted / proposed < 0.5) {
    return [
      {
        severity: "info",
        stage: "medical_flags",
        message: `Treatment acceptance rate is ${((accepted / proposed) * 100).toFixed(1)}%. Only ${accepted} of ${proposed} proposed treatments were accepted.`,
        recommendation:
          "Review treatment proposals for alignment with patient expectations and medical feasibility.",
      },
    ];
  }

  return [];
};
