// ---------------------------------------------------------------------------
// Conversation Template: Lead Qualification
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../types.js";

export const qualificationFlow: ConversationFlowDefinition = {
  id: "qualification",
  name: "Lead Qualification",
  description: "Qualifies incoming leads through structured conversation.",
  variables: ["patientName", "treatmentInterest", "source", "clinicName"],
  steps: [
    {
      id: "greeting",
      type: "message",
      template: "Hi {{patientName}}! Thank you for your interest in {{treatmentInterest}} at {{clinicName}}. I'd love to help you get started.",
    },
    {
      id: "timeline_question",
      type: "question",
      template: "When are you looking to start treatment?",
      options: ["As soon as possible", "Within a month", "Just exploring options"],
    },
    {
      id: "budget_question",
      type: "question",
      template: "Do you have a budget in mind for your {{treatmentInterest}}?",
      options: ["Yes, I have a budget", "I'd like to know pricing first", "Flexible budget"],
    },
    {
      id: "insurance_question",
      type: "question",
      template: "Will you be using insurance for this treatment?",
      options: ["Yes", "No", "Not sure"],
    },
    {
      id: "score_lead",
      type: "score",
      template: "Thank you for sharing that information, {{patientName}}. Let me find the best options for you.",
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
      template: "Great news! Based on your needs, I'd recommend scheduling a consultation. We have availability this week.",
      nextStepId: "book_action",
    },
    {
      id: "nurture_response",
      type: "message",
      template: "I'd be happy to send you more information about {{treatmentInterest}}. In the meantime, feel free to ask any questions.",
    },
    {
      id: "book_action",
      type: "action",
      template: "Let me check available consultation times for you.",
      actionType: "patient-engagement.appointment.book",
      actionParameters: { patientId: "{{patientId}}", treatmentType: "{{treatmentInterest}}" },
    },
  ],
};
