// ---------------------------------------------------------------------------
// Retention Agent — conversation flows
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../../conversation/types.js";

/** Dormant customer win-back flow */
export const winBackFlow: ConversationFlowDefinition = {
  id: "win-back",
  name: "Dormant Customer Win-Back",
  description: "Re-engages dormant customers with personalized outreach.",
  variables: ["contactName", "lastServiceType", "daysSinceLastVisit", "businessName"],
  steps: [
    {
      id: "reintro",
      type: "message",
      template:
        "Hi {{contactName}}, it's been a while since your last visit to {{businessName}}! We've missed you.",
    },
    {
      id: "offer",
      type: "message",
      template:
        "We have some exciting new services that complement your previous {{lastServiceType}}. Would you like to hear about them?",
    },
    {
      id: "interest_question",
      type: "question",
      template: "What would be most helpful for you?",
      options: [
        "Schedule a follow-up consultation",
        "Learn about new services",
        "Not interested right now",
      ],
    },
    {
      id: "interest_branch",
      type: "branch",
      branches: [
        {
          variable: "interest",
          operator: "eq",
          value: "schedule",
          targetStepId: "schedule_action",
        },
        { variable: "interest", operator: "eq", value: "learn", targetStepId: "info_message" },
        {
          variable: "interest",
          operator: "eq",
          value: "not_interested",
          targetStepId: "respect_decline",
        },
      ],
    },
    {
      id: "schedule_action",
      type: "action",
      template: "Let me find a convenient time for you.",
      actionType: "customer-engagement.appointment.book",
      actionParameters: { contactId: "{{contactId}}" },
    },
    {
      id: "info_message",
      type: "message",
      template:
        "We'll send you some information about our latest offerings. Feel free to reach out anytime!",
    },
    {
      id: "respect_decline",
      type: "message",
      template:
        "No problem at all, {{contactName}}. We're here whenever you're ready. Have a great day!",
    },
  ],
};

export const RETENTION_FLOWS: ConversationFlowDefinition[] = [winBackFlow];
