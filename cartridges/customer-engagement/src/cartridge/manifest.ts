// ---------------------------------------------------------------------------
// Customer Engagement Cartridge — Action Manifest
// ---------------------------------------------------------------------------
// 16 action definitions covering the full customer lifecycle.
// ---------------------------------------------------------------------------

import type { ActionDefinition } from "@switchboard/schemas";

export const CUSTOMER_ENGAGEMENT_ACTIONS: ActionDefinition[] = [
  // ── Lead Management ─────────────────────────────────────────────────
  {
    actionType: "customer-engagement.lead.qualify",
    name: "Qualify Lead",
    description:
      "Evaluate and qualify an incoming lead based on treatment interest, urgency, and engagement signals.",
    parametersSchema: {
      contactId: { type: "string" },
      serviceInterest: { type: "string" },
      source: { type: "string" },
      urgencyLevel: { type: "number" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "customer-engagement.lead.score",
    name: "Score Lead",
    description:
      "Compute a deterministic 0-100 lead score based on treatment value, urgency, budget, and engagement.",
    parametersSchema: {
      contactId: { type: "string" },
      serviceValue: { type: "number" },
      urgencyLevel: { type: "number" },
      source: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },

  // ── Appointment Management ──────────────────────────────────────────
  {
    actionType: "customer-engagement.appointment.book",
    name: "Book Appointment",
    description: "Book a consultation or treatment appointment for a customer.",
    parametersSchema: {
      contactId: { type: "string" },
      providerId: { type: "string" },
      startTime: { type: "string" },
      serviceType: { type: "string" },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },
  {
    actionType: "customer-engagement.appointment.cancel",
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
    actionType: "customer-engagement.appointment.reschedule",
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
    actionType: "customer-engagement.reminder.send",
    name: "Send Reminder",
    description: "Send an appointment or follow-up reminder to a customer via SMS.",
    parametersSchema: {
      contactId: { type: "string" },
      appointmentId: { type: "string" },
      channel: { type: "string" },
      message: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },

  // ── Cadence Management ──────────────────────────────────────────────
  {
    actionType: "customer-engagement.cadence.start",
    name: "Start Cadence",
    description: "Start a multi-step outreach cadence for a contact.",
    parametersSchema: {
      contactId: { type: "string" },
      cadenceTemplateId: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "customer-engagement.cadence.stop",
    name: "Stop Cadence",
    description: "Stop an active cadence for a contact.",
    parametersSchema: {
      cadenceInstanceId: { type: "string" },
      reason: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },

  // ── Treatment Tracking ─────────────────────────────────────────────
  {
    actionType: "customer-engagement.treatment.log",
    name: "Log Treatment",
    description: "Log a completed treatment for a contact with outcome tracking.",
    parametersSchema: {
      contactId: { type: "string" },
      serviceType: { type: "string" },
      value: { type: "number" },
      providerId: { type: "string" },
      notes: { type: "string" },
    },
    baseRiskCategory: "medium",
    reversible: false,
  },

  // ── Review Management ──────────────────────────────────────────────
  {
    actionType: "customer-engagement.review.request",
    name: "Request Review",
    description: "Send a review solicitation to a customer after treatment.",
    parametersSchema: {
      contactId: { type: "string" },
      platform: { type: "string" },
      message: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "customer-engagement.review.respond",
    name: "Respond to Review",
    description: "Post a public response to a customer review on an external platform.",
    parametersSchema: {
      reviewId: { type: "string" },
      responseText: { type: "string" },
    },
    baseRiskCategory: "high",
    reversible: false,
  },

  // ── Journey Management ─────────────────────────────────────────────
  {
    actionType: "customer-engagement.journey.update_stage",
    name: "Update Journey Stage",
    description: "Move a contact to a new stage in the journey lifecycle.",
    parametersSchema: {
      contactId: { type: "string" },
      newStage: { type: "string" },
      reason: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: true,
  },

  // ── Diagnostics ────────────────────────────────────────────────────
  {
    actionType: "customer-engagement.pipeline.diagnose",
    name: "Diagnose Customer Pipeline",
    description:
      "Run a full journey diagnostic across all stages with period-over-period comparison.",
    parametersSchema: {
      organizationId: { type: "string" },
      currentPeriod: { type: "object" },
      previousPeriod: { type: "object" },
      businessType: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },

  // ── Scoring ────────────────────────────────────────────────────────
  {
    actionType: "customer-engagement.contact.score_ltv",
    name: "Score Contact LTV",
    description: "Compute a deterministic lifetime value prediction for a contact.",
    parametersSchema: {
      contactId: { type: "string" },
      averageServiceValue: { type: "number" },
      visitFrequency: { type: "number" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },

  // ── Conversation ───────────────────────────────────────────────────
  {
    actionType: "customer-engagement.conversation.handle_objection",
    name: "Handle Objection",
    description: "Match and respond to a customer objection using deterministic objection trees.",
    parametersSchema: {
      contactId: { type: "string" },
      objectionText: { type: "string" },
      context: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "customer-engagement.conversation.escalate",
    name: "Escalate Conversation",
    description: "Escalate a customer conversation to a human operator.",
    parametersSchema: {
      contactId: { type: "string" },
      reason: { type: "string" },
      conversationHistory: { type: "array" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
];

export const CUSTOMER_ENGAGEMENT_MANIFEST = {
  id: "customer-engagement",
  name: "Customer Engagement",
  version: "0.1.0",
  description:
    "Full customer lifecycle management: lead qualification, booking, treatment tracking, review solicitation, cadence automation, and journey diagnostics.",
  actions: CUSTOMER_ENGAGEMENT_ACTIONS,
  requiredConnections: ["calendar", "sms", "review_platform"],
  defaultPolicies: [
    "customer-engagement-consent-required",
    "customer-engagement-review-elevated-approval",
    "customer-engagement-booking-approval",
    "customer-engagement-treatment-approval",
  ],
} satisfies import("@switchboard/schemas").CartridgeManifest;
