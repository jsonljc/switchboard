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
    case "patient-engagement.lead.score":
    case "patient-engagement.patient.score_ltv":
    case "patient-engagement.pipeline.diagnose":
      return readRisk("none");

    case "patient-engagement.lead.qualify":
    case "patient-engagement.journey.update_stage":
    case "patient-engagement.conversation.handle_objection":
    case "patient-engagement.conversation.escalate":
      return readRisk("low");

    // ── Outbound communication ────────────────────────────────────────
    case "patient-engagement.reminder.send":
    case "patient-engagement.review.request":
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "none",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Appointment management ────────────────────────────────────────
    case "patient-engagement.appointment.book":
    case "patient-engagement.appointment.cancel":
    case "patient-engagement.appointment.reschedule":
      return {
        baseRisk: "medium",
        exposure: {
          dollarsAtRisk: Number(parameters.treatmentValue ?? 200),
          blastRadius: 1,
        },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Public-facing responses ───────────────────────────────────────
    case "patient-engagement.review.respond":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: 0, blastRadius: 100 },
        reversibility: "none",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Treatment logging ─────────────────────────────────────────────
    case "patient-engagement.treatment.log":
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
    case "patient-engagement.cadence.start":
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    case "patient-engagement.cadence.stop":
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
