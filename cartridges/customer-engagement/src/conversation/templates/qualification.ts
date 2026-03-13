// ---------------------------------------------------------------------------
// Conversation Template: Lead Qualification
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../types.js";

export const qualificationFlow: ConversationFlowDefinition = {
  id: "qualification",
  name: "Lead Qualification",
  description: "Qualifies incoming leads through structured conversation.",
  variables: ["contactName", "serviceInterest", "source", "businessName"],
  steps: [
    {
      id: "greeting",
      type: "message",
      template:
        "Hi {{contactName}}! Thank you for your interest in {{serviceInterest}} at {{businessName}}. I'd love to help you get started.",
    },
    {
      id: "timeline_question",
      type: "question",
      template: "When are you looking to get started?",
      options: ["As soon as possible", "Within a month", "Just exploring options"],
    },
    {
      id: "budget_question",
      type: "question",
      template: "Do you have a budget in mind for your {{serviceInterest}}?",
      options: ["Yes, I have a budget", "I'd like to know pricing first", "Flexible budget"],
    },
    {
      id: "insurance_question",
      type: "question",
      template: "Do you have any questions about pricing or payment options?",
      options: ["Yes, tell me more", "No, I'm ready to proceed", "I'd like to discuss options"],
    },
    {
      id: "score_lead",
      type: "score",
      template:
        "Thank you for sharing that information, {{contactName}}. Let me find the best options for you.",
    },
    {
      id: "qualify_branch",
      type: "branch",
      branches: [
        { variable: "leadScore", operator: "gte", value: 50, targetStepId: "qualified_response" },
        { variable: "leadScore", operator: "lt", value: 50, targetStepId: "nurture_response" },
      ],
    },
    {
      id: "qualified_response",
      type: "message",
      template:
        "Great news! Based on your needs, I'd recommend scheduling a consultation. We have availability this week.",
      nextStepId: "book_action",
    },
    {
      id: "nurture_response",
      type: "message",
      template:
        "I'd be happy to send you more information about {{serviceInterest}}. In the meantime, feel free to ask any questions.",
    },
    {
      id: "book_action",
      type: "action",
      template: "Let me check available consultation times for you.",
      actionType: "customer-engagement.appointment.book",
      actionParameters: { contactId: "{{contactId}}", serviceType: "{{serviceInterest}}" },
    },
  ],
};
