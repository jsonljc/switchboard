// ---------------------------------------------------------------------------
// Conversation Template: Post-Treatment Follow-up
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../types.js";

export const postTreatmentFlow: ConversationFlowDefinition = {
  id: "post-treatment",
  name: "Post-Treatment Follow-up",
  description: "Checks in with customers after service completion.",
  variables: ["contactName", "serviceType", "daysSinceTreatment", "providerName"],
  steps: [
    {
      id: "checkin",
      type: "message",
      template:
        "Hi {{contactName}}, I hope you're doing well! It's been {{daysSinceTreatment}} days since your {{serviceType}}. How was your experience?",
    },
    {
      id: "satisfaction_question",
      type: "question",
      template: "On a scale of 1-5, how satisfied are you with your results?",
      options: [
        "5 - Very satisfied",
        "4 - Satisfied",
        "3 - Neutral",
        "2 - Unsatisfied",
        "1 - Very unsatisfied",
      ],
    },
    {
      id: "satisfaction_branch",
      type: "branch",
      branches: [
        { variable: "satisfaction", operator: "gte", value: 4, targetStepId: "positive_followup" },
        { variable: "satisfaction", operator: "lte", value: 2, targetStepId: "concern_followup" },
        { variable: "satisfaction", operator: "eq", value: 3, targetStepId: "neutral_followup" },
      ],
    },
    {
      id: "positive_followup",
      type: "message",
      template: "That's wonderful to hear! Would you mind sharing your experience with others?",
      nextStepId: "review_request",
    },
    {
      id: "neutral_followup",
      type: "message",
      template: "Thank you for your feedback. Is there anything we could have done differently?",
    },
    {
      id: "concern_followup",
      type: "escalate",
      template:
        "I'm sorry to hear that. Let me connect you with {{providerName}} to address your concerns right away.",
      escalationReason: "Customer expressed dissatisfaction with service results",
    },
    {
      id: "review_request",
      type: "action",
      template: "We'd really appreciate a review! Here's a link to share your experience.",
      actionType: "customer-engagement.review.request",
      actionParameters: { contactId: "{{contactId}}", platform: "google" },
    },
  ],
};
