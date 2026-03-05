// ---------------------------------------------------------------------------
// Default Policies — Customer Engagement
// ---------------------------------------------------------------------------

import type { Policy } from "@switchboard/schemas";

export const DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES: Policy[] = [
  // Priority 1: Block outbound communication without active consent
  {
    id: "customer-engagement-consent-required",
    name: "Customer Engagement Consent Required",
    description: "Block all outbound communication if contact consent is not active.",
    organizationId: null,
    cartridgeId: "customer-engagement",
    priority: 1,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: [
            "customer-engagement.reminder.send",
            "customer-engagement.review.request",
            "customer-engagement.cadence.start",
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
    id: "customer-engagement-review-elevated-approval",
    name: "Customer Engagement Review Response Elevated Approval",
    description: "Public review responses require elevated approval due to reputational risk.",
    organizationId: null,
    cartridgeId: "customer-engagement",
    priority: 5,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "eq",
          value: "customer-engagement.review.respond",
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
    id: "customer-engagement-booking-approval",
    name: "Customer Engagement Booking Approval",
    description: "Booking, cancellation, and rescheduling actions require standard approval.",
    organizationId: null,
    cartridgeId: "customer-engagement",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: [
            "customer-engagement.appointment.book",
            "customer-engagement.appointment.cancel",
            "customer-engagement.appointment.reschedule",
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
    id: "customer-engagement-treatment-approval",
    name: "Customer Engagement Treatment Logging Approval",
    description: "Treatment logging requires standard approval for data integrity.",
    organizationId: null,
    cartridgeId: "customer-engagement",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "eq",
          value: "customer-engagement.treatment.log",
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
