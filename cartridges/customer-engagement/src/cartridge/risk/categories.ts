// ---------------------------------------------------------------------------
// Risk Categories — per-action risk computation
// ---------------------------------------------------------------------------

import type { RiskInput } from "@switchboard/schemas";

export function computeRiskInput(
  actionType: string,
  parameters: Record<string, unknown>,
  _context?: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    // ── Read / Diagnostic actions ─────────────────────────────────────
    case "customer-engagement.lead.score":
    case "customer-engagement.contact.score_ltv":
    case "customer-engagement.pipeline.diagnose":
      return readRisk("none");

    case "customer-engagement.lead.qualify":
    case "customer-engagement.journey.update_stage":
    case "customer-engagement.conversation.handle_objection":
    case "customer-engagement.conversation.escalate":
      return readRisk("low");

    // ── Outbound communication ────────────────────────────────────────
    case "customer-engagement.reminder.send":
    case "customer-engagement.review.request":
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "none",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Appointment management ────────────────────────────────────────
    case "customer-engagement.appointment.book":
    case "customer-engagement.appointment.cancel":
    case "customer-engagement.appointment.reschedule":
      return {
        baseRisk: "medium",
        exposure: {
          dollarsAtRisk: Number(parameters.serviceValue ?? 200),
          blastRadius: 1,
        },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Public-facing responses ───────────────────────────────────────
    case "customer-engagement.review.respond":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: 0, blastRadius: 100 },
        reversibility: "none",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Treatment logging ─────────────────────────────────────────────
    case "customer-engagement.treatment.log":
      return {
        baseRisk: "medium",
        exposure: {
          dollarsAtRisk: Number(parameters.value ?? 0),
          blastRadius: 1,
        },
        reversibility: "partial",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Cadence management ────────────────────────────────────────────
    case "customer-engagement.cadence.start":
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    case "customer-engagement.cadence.stop":
      return readRisk("low");

    default:
      return readRisk("low");
  }
}

function readRisk(baseRisk: "none" | "low"): RiskInput {
  return {
    baseRisk,
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}
