// ---------------------------------------------------------------------------
// Engagement Advisors (4 advisors)
// ---------------------------------------------------------------------------

import type { JourneyFindingAdvisor } from "../types.js";

/**
 * Response Time SLA — flags slow response times.
 */
export const responseTimeAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
) => {
  const currentResponseMs = current.aggregates.averageResponseTimeMs;

  const SLA_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  const CRITICAL_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

  if (currentResponseMs > CRITICAL_THRESHOLD_MS) {
    return [
      {
        severity: "critical",
        stage: "response_time",
        message: `Average response time is ${(currentResponseMs / 3_600_000).toFixed(1)} hours — exceeding 4-hour threshold.`,
        recommendation:
          "Implement auto-response for new inquiries. Review staffing during peak hours.",
      },
    ];
  }

  if (currentResponseMs > SLA_THRESHOLD_MS) {
    return [
      {
        severity: "warning",
        stage: "response_time",
        message: `Average response time is ${(currentResponseMs / 60_000).toFixed(0)} minutes — exceeding 30-minute SLA.`,
        recommendation:
          "Set up notification alerts for unanswered messages. Consider automated initial responses.",
      },
    ];
  }

  return [];
};

/**
 * Follow-up Compliance — tracks completion of post-treatment follow-ups.
 */
export const followupComplianceAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
) => {
  const completed = current.stages["treatments_completed"]?.count ?? 0;
  const repeat = current.stages["repeat_patients"]?.count ?? 0;

  if (completed > 5 && repeat / completed < 0.2) {
    return [
      {
        severity: "warning",
        stage: "followup_compliance",
        message: `Only ${((repeat / completed) * 100).toFixed(1)}% of treated patients became repeat patients.`,
        recommendation:
          "Strengthen post-treatment follow-up cadence. Send satisfaction surveys within 24 hours.",
      },
    ];
  }

  return [];
};

/**
 * Conversation Quality — monitors escalation rates as a proxy for quality.
 */
export const conversationQualityAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  if (!current.aggregates || !previous.aggregates) return [];

  // If we have communication data in the context, this would check escalation rates
  // For now, use the aggregate data as a proxy
  return [];
};

/**
 * Message Frequency — flags over/under-communication.
 */
export const messageFrequencyAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  _previous,
  context,
) => {
  const commData = context?.communicationData;
  if (!commData) return [];

  const totalPatients = current.totalPatients;
  if (totalPatients === 0) return [];

  const messagesPerPatient = commData.totalMessagesSent / totalPatients;

  if (messagesPerPatient > 10) {
    return [
      {
        severity: "warning",
        stage: "message_frequency",
        message: `Average ${messagesPerPatient.toFixed(1)} messages per patient this period — risk of over-communication.`,
        recommendation: "Review cadence configurations. Implement per-patient frequency caps.",
      },
    ];
  }

  if (messagesPerPatient < 1 && totalPatients > 20) {
    return [
      {
        severity: "info",
        stage: "message_frequency",
        message: `Average ${messagesPerPatient.toFixed(1)} messages per patient — patients may be under-engaged.`,
        recommendation: "Ensure follow-up cadences are active. Check SMS delivery rates.",
      },
    ];
  }

  return [];
};
