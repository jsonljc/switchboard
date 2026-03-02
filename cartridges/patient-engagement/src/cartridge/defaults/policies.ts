// ---------------------------------------------------------------------------
// Default Policies — Patient Engagement
// ---------------------------------------------------------------------------

import type { Policy } from "@switchboard/schemas";

export const DEFAULT_PATIENT_ENGAGEMENT_POLICIES: Policy[] = [
  // Priority 1: Block outbound communication without active consent
  {
    id: "patient-engagement-consent-required",
    name: "Patient Engagement Consent Required",
    description: "Block all outbound communication if patient consent is not active.",
    organizationId: null,
    cartridgeId: "patient-engagement",
    priority: 1,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: [
            "patient-engagement.reminder.send",
            "patient-engagement.review.request",
            "patient-engagement.cadence.start",
          ],
        },
        { field: "metadata.consentStatus", operator: "neq", value: "active" },
      ],
    },
    effect: "deny",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 5: Review responses require elevated approval
  {
    id: "patient-engagement-review-elevated-approval",
    name: "Patient Engagement Review Response Elevated Approval",
    description: "Public review responses require elevated approval due to reputational risk.",
    organizationId: null,
    cartridgeId: "patient-engagement",
    priority: 5,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "eq",
          value: "patient-engagement.review.respond",
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 10: Booking/cancel/reschedule require standard approval
  {
    id: "patient-engagement-booking-approval",
    name: "Patient Engagement Booking Approval",
    description: "Booking, cancellation, and rescheduling actions require standard approval.",
    organizationId: null,
    cartridgeId: "patient-engagement",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: [
            "patient-engagement.appointment.book",
            "patient-engagement.appointment.cancel",
            "patient-engagement.appointment.reschedule",
          ],
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 20: Treatment logging requires standard approval
  {
    id: "patient-engagement-treatment-approval",
    name: "Patient Engagement Treatment Logging Approval",
    description: "Treatment logging requires standard approval for data integrity.",
    organizationId: null,
    cartridgeId: "patient-engagement",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "eq",
          value: "patient-engagement.treatment.log",
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
