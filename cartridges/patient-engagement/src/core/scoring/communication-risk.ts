// ---------------------------------------------------------------------------
// Communication Risk — Deterministic gating
// ---------------------------------------------------------------------------
// Evaluates whether it's safe to communicate with a patient based on
// consent, frequency, sentiment, and complaint signals.
// ---------------------------------------------------------------------------

import type { CommunicationRiskResult, CommunicationRiskLevel, ConsentStatus } from "../types.js";

export interface CommunicationRiskInput {
  consentStatus: ConsentStatus;
  messagesSentToday: number;
  messagesSentThisWeek: number;
  lastMessageSentAt: Date | null;
  sentimentScore: number; // -1 to 1
  complaintCount: number;
  optOutRequested: boolean;
}

/**
 * Compute communication risk level deterministically.
 *
 * Risk levels:
 * - blocked: Cannot send any communication
 * - restricted: Only critical/transactional messages allowed
 * - caution: Reduced frequency, avoid promotional content
 * - safe: Normal communication allowed
 */
export function computeCommunicationRisk(input: CommunicationRiskInput): CommunicationRiskResult {
  const reasons: string[] = [];

  // Hard blocks
  if (input.consentStatus === "revoked" || input.optOutRequested) {
    return {
      level: "blocked",
      reasons: [input.optOutRequested ? "Patient opted out" : "Consent revoked"],
      maxMessagesPerDay: 0,
    };
  }

  if (input.consentStatus === "expired") {
    return {
      level: "blocked",
      reasons: ["Consent expired — renewal required"],
      maxMessagesPerDay: 0,
    };
  }

  if (input.consentStatus === "pending") {
    return {
      level: "restricted",
      reasons: ["Consent pending — only transactional messages allowed"],
      maxMessagesPerDay: 1,
    };
  }

  let level: CommunicationRiskLevel = "safe";
  let maxMessagesPerDay = 5;

  // Complaint escalation
  if (input.complaintCount >= 3) {
    level = "restricted";
    maxMessagesPerDay = 1;
    reasons.push(`${input.complaintCount} complaints on file`);
  } else if (input.complaintCount >= 1) {
    level = escalate(level, "caution");
    maxMessagesPerDay = Math.min(maxMessagesPerDay, 3);
    reasons.push(`${input.complaintCount} complaint(s) on file`);
  }

  // Negative sentiment
  if (input.sentimentScore < -0.5) {
    level = escalate(level, "restricted");
    maxMessagesPerDay = Math.min(maxMessagesPerDay, 1);
    reasons.push("Strong negative sentiment detected");
  } else if (input.sentimentScore < -0.2) {
    level = escalate(level, "caution");
    maxMessagesPerDay = Math.min(maxMessagesPerDay, 3);
    reasons.push("Negative sentiment detected");
  }

  // Daily frequency cap
  if (input.messagesSentToday >= 5) {
    level = escalate(level, "restricted");
    maxMessagesPerDay = 0;
    reasons.push("Daily message limit reached (5/day)");
  } else if (input.messagesSentToday >= 3) {
    level = escalate(level, "caution");
    maxMessagesPerDay = Math.min(maxMessagesPerDay, 5 - input.messagesSentToday);
    reasons.push(`${input.messagesSentToday} messages sent today`);
  }

  // Weekly frequency cap
  if (input.messagesSentThisWeek >= 15) {
    level = escalate(level, "restricted");
    maxMessagesPerDay = Math.min(maxMessagesPerDay, 1);
    reasons.push("Weekly message limit approaching (15/week)");
  }

  // Recency cooldown
  if (input.lastMessageSentAt) {
    const minutesSinceLast = (Date.now() - input.lastMessageSentAt.getTime()) / 60_000;
    if (minutesSinceLast < 30) {
      level = escalate(level, "caution");
      reasons.push("Message sent within last 30 minutes");
    }
  }

  return { level, reasons, maxMessagesPerDay };
}

const RISK_ORDER: CommunicationRiskLevel[] = ["safe", "caution", "restricted", "blocked"];

function escalate(
  current: CommunicationRiskLevel,
  proposed: CommunicationRiskLevel,
): CommunicationRiskLevel {
  const currentIdx = RISK_ORDER.indexOf(current);
  const proposedIdx = RISK_ORDER.indexOf(proposed);
  return proposedIdx > currentIdx ? proposed : current;
}
