// ---------------------------------------------------------------------------
// Compliance Advisors (5 advisors)
// ---------------------------------------------------------------------------

import type { JourneyFindingAdvisor } from "../types.js";

/**
 * Consent Coverage — checks percentage of patients with active consent.
 */
export const consentStatusAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  _current,
  _previous,
  context,
) => {
  const commData = context?.communicationData;
  if (!commData) return [];

  if (commData.consentCoverage < 0.8) {
    return [
      {
        severity: "warning",
        stage: "consent_status",
        message: `Consent coverage is ${(commData.consentCoverage * 100).toFixed(1)}% — below 80% threshold.`,
        recommendation:
          "Implement consent collection at intake. Send consent renewal reminders before expiration.",
      },
    ];
  }

  if (commData.consentCoverage < 0.95) {
    return [
      {
        severity: "info",
        stage: "consent_status",
        message: `Consent coverage is ${(commData.consentCoverage * 100).toFixed(1)}%.`,
        recommendation: "Review consent renewal workflow for upcoming expirations.",
      },
    ];
  }

  return [];
};

/**
 * Communication Frequency — enforces per-patient message limits.
 */
export const communicationFrequencyAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
  context,
) => {
  const commData = context?.communicationData;
  if (!commData) return [];

  const totalContacts = current.totalContacts;
  if (totalContacts === 0) return [];

  const avgMessages = commData.totalMessagesSent / totalContacts;

  // Daily limit is 5 per patient; flag if approaching weekly limits
  if (avgMessages > 20) {
    return [
      {
        severity: "critical",
        stage: "communication_frequency",
        message: `Average ${avgMessages.toFixed(1)} messages per patient this period — exceeding safe limits.`,
        recommendation: "Immediately audit cadence configurations. Enforce daily per-patient caps.",
      },
    ];
  }

  return [];
};

/**
 * Escalation Rate — tracks how often conversations require human intervention.
 */
export const escalationRateAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  _current,
  _previous,
  context,
) => {
  const commData = context?.communicationData;
  if (!commData) return [];

  if (commData.escalationRate > 0.3) {
    return [
      {
        severity: "warning",
        stage: "escalation_rate",
        message: `Escalation rate is ${(commData.escalationRate * 100).toFixed(1)}% — more than 30% of conversations require human intervention.`,
        recommendation:
          "Expand objection handling trees. Review common escalation reasons and add automated responses.",
      },
    ];
  }

  return [];
};

/**
 * Data Retention — flags data that may need cleanup per retention policies.
 */
export const dataRetentionAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
) => {
  // Track dormant and lost patients for data retention compliance
  const dormant = current.stages["dormant_customers"]?.count ?? 0;
  const lost = current.stages["lost_customers"]?.count ?? 0;
  const total = current.totalContacts;

  if (total > 0 && (dormant + lost) / total > 0.5) {
    return [
      {
        severity: "info",
        stage: "data_retention",
        message: `${dormant + lost} of ${total} patients (${(((dormant + lost) / total) * 100).toFixed(1)}%) are dormant or lost.`,
        recommendation:
          "Review data retention policy. Consider archiving records older than retention period.",
      },
    ];
  }

  return [];
};

/**
 * Medical Claim Compliance — monitors for potential medical claims in communications.
 */
export const medicalClaimAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
) => {
  // This advisor serves as a periodic reminder to audit outbound communications
  // Actual claim detection is done by the MedicalClaimFilter interceptor
  const completed = current.stages["services_completed"]?.count ?? 0;
  const reviews = current.aggregates.reviewCount;

  if (completed > 10 && reviews > 5) {
    return [
      {
        severity: "info",
        stage: "medical_claim_compliance",
        message:
          "Periodic reminder: audit outbound communications for medical claims and guarantees.",
        recommendation: "Review recent review responses and marketing messages for compliance.",
      },
    ];
  }

  return [];
};
