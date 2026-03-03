// ---------------------------------------------------------------------------
// Conversation Template: Review Request
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../types.js";

export const reviewRequestFlow: ConversationFlowDefinition = {
  id: "review-request",
  name: "Review Solicitation",
  description: "Requests a review from a satisfied patient.",
  variables: ["patientName", "treatmentType", "clinicName", "reviewLink"],
  steps: [
    {
      id: "intro",
      type: "message",
      template:
        "Hi {{patientName}}! We hope you're enjoying the results of your {{treatmentType}} at {{clinicName}}.",
    },
    {
      id: "ask",
      type: "message",
      template:
        "Your feedback helps others find great care. Would you take a moment to share your experience?",
    },
    {
      id: "link",
      type: "action",
      template: "Here's a quick link to leave a review: {{reviewLink}}",
      actionType: "patient-engagement.review.request",
      actionParameters: { patientId: "{{patientId}}", platform: "google" },
    },
    {
      id: "thanks",
      type: "message",
      template: "Thank you so much, {{patientName}}! We truly appreciate your support.",
    },
  ],
};
