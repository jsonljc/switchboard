// ---------------------------------------------------------------------------
// Patient Engagement Cartridge — Action Manifest
// ---------------------------------------------------------------------------
// 16 action definitions covering the full patient lifecycle.
// ---------------------------------------------------------------------------

import type { ActionDefinition } from "@switchboard/schemas";

export const PATIENT_ENGAGEMENT_ACTIONS: ActionDefinition[] = [
  // ── Lead Management ─────────────────────────────────────────────────
  {
    actionType: "patient-engagement.lead.qualify",
    name: "Qualify Lead",
    description:
      "Evaluate and qualify an incoming lead based on treatment interest, urgency, and engagement signals.",
    parametersSchema: {
      patientId: { type: "string" },
      treatmentInterest: { type: "string" },
      source: { type: "string" },
      urgencyLevel: { type: "number" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "patient-engagement.lead.score",
    name: "Score Lead",
    description:
      "Compute a deterministic 0-100 lead score based on treatment value, urgency, budget, and engagement.",
    parametersSchema: {
      patientId: { type: "string" },
      treatmentValue: { type: "number" },
      urgencyLevel: { type: "number" },
      source: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },

  // ── Appointment Management ──────────────────────────────────────────
  {
    actionType: "patient-engagement.appointment.book",
    name: "Book Appointment",
    description: "Book a consultation or treatment appointment for a patient.",
    parametersSchema: {
      patientId: { type: "string" },
      providerId: { type: "string" },
      startTime: { type: "string" },
      treatmentType: { type: "string" },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },
  {
    actionType: "patient-engagement.appointment.cancel",
    name: "Cancel Appointment",
    description: "Cancel an existing appointment.",
    parametersSchema: {
      appointmentId: { type: "string" },
      reason: { type: "string" },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },
  {
    actionType: "patient-engagement.appointment.reschedule",
    name: "Reschedule Appointment",
    description: "Reschedule an existing appointment to a new time.",
    parametersSchema: {
      appointmentId: { type: "string" },
      newStartTime: { type: "string" },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },

  // ── Communication ───────────────────────────────────────────────────
  {
    actionType: "patient-engagement.reminder.send",
    name: "Send Reminder",
    description: "Send an appointment or follow-up reminder to a patient via SMS.",
    parametersSchema: {
      patientId: { type: "string" },
      appointmentId: { type: "string" },
      channel: { type: "string" },
      message: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },

  // ── Cadence Management ──────────────────────────────────────────────
  {
    actionType: "patient-engagement.cadence.start",
    name: "Start Cadence",
    description: "Start a multi-step outreach cadence for a patient.",
    parametersSchema: {
      patientId: { type: "string" },
      cadenceTemplateId: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "patient-engagement.cadence.stop",
    name: "Stop Cadence",
    description: "Stop an active cadence for a patient.",
    parametersSchema: {
      cadenceInstanceId: { type: "string" },
      reason: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },

  // ── Treatment Tracking ─────────────────────────────────────────────
  {
    actionType: "patient-engagement.treatment.log",
    name: "Log Treatment",
    description: "Log a completed treatment for a patient with outcome tracking.",
    parametersSchema: {
      patientId: { type: "string" },
      treatmentType: { type: "string" },
      value: { type: "number" },
      providerId: { type: "string" },
      notes: { type: "string" },
    },
    baseRiskCategory: "medium",
    reversible: false,
  },

  // ── Review Management ──────────────────────────────────────────────
  {
    actionType: "patient-engagement.review.request",
    name: "Request Review",
    description: "Send a review solicitation to a patient after treatment.",
    parametersSchema: {
      patientId: { type: "string" },
      platform: { type: "string" },
      message: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "patient-engagement.review.respond",
    name: "Respond to Review",
    description: "Post a public response to a patient review on an external platform.",
    parametersSchema: {
      reviewId: { type: "string" },
      responseText: { type: "string" },
    },
    baseRiskCategory: "high",
    reversible: false,
  },

  // ── Journey Management ─────────────────────────────────────────────
  {
    actionType: "patient-engagement.journey.update_stage",
    name: "Update Journey Stage",
    description: "Move a patient to a new stage in the journey lifecycle.",
    parametersSchema: {
      patientId: { type: "string" },
      newStage: { type: "string" },
      reason: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: true,
  },

  // ── Diagnostics ────────────────────────────────────────────────────
  {
    actionType: "patient-engagement.pipeline.diagnose",
    name: "Diagnose Patient Pipeline",
    description:
      "Run a full journey diagnostic across all stages with period-over-period comparison.",
    parametersSchema: {
      organizationId: { type: "string" },
      currentPeriod: { type: "object" },
      previousPeriod: { type: "object" },
      clinicType: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },

  // ── Scoring ────────────────────────────────────────────────────────
  {
    actionType: "patient-engagement.patient.score_ltv",
    name: "Score Patient LTV",
    description: "Compute a deterministic lifetime value prediction for a patient.",
    parametersSchema: {
      patientId: { type: "string" },
      averageTreatmentValue: { type: "number" },
      visitFrequency: { type: "number" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },

  // ── Conversation ───────────────────────────────────────────────────
  {
    actionType: "patient-engagement.conversation.handle_objection",
    name: "Handle Objection",
    description: "Match and respond to a patient objection using deterministic objection trees.",
    parametersSchema: {
      patientId: { type: "string" },
      objectionText: { type: "string" },
      context: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "patient-engagement.conversation.escalate",
    name: "Escalate Conversation",
    description: "Escalate a patient conversation to a human operator.",
    parametersSchema: {
      patientId: { type: "string" },
      reason: { type: "string" },
      conversationHistory: { type: "array" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
];

export const PATIENT_ENGAGEMENT_MANIFEST = {
  id: "patient-engagement",
  name: "Patient Engagement",
  version: "0.1.0",
  description:
    "Full patient lifecycle management: lead qualification, booking, treatment tracking, review solicitation, cadence automation, and journey diagnostics.",
  actions: PATIENT_ENGAGEMENT_ACTIONS,
  requiredConnections: ["calendar", "sms", "review_platform"],
  defaultPolicies: [
    "patient-engagement-consent-required",
    "patient-engagement-review-elevated-approval",
    "patient-engagement-booking-approval",
    "patient-engagement-treatment-approval",
  ],
} satisfies import("@switchboard/schemas").CartridgeManifest;
