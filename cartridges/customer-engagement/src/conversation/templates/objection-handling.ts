// ---------------------------------------------------------------------------
// Conversation Template: Objection Handling
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../types.js";

export const objectionHandlingFlow: ConversationFlowDefinition = {
  id: "objection-handling",
  name: "Objection Handling",
  description: "Responds to common customer objections deterministically.",
  variables: ["contactName", "objectionCategory", "serviceType", "objectionResponse"],
  steps: [
    {
      id: "acknowledge",
      type: "message",
      template:
        "I completely understand your concern, {{contactName}}. That's a very common question.",
    },
    {
      id: "respond",
      type: "objection",
      template: "{{objectionResponse}}",
    },
    {
      id: "followup_question",
      type: "question",
      template: "Does that help address your concern?",
      options: ["Yes, that helps", "I still have questions", "I'd like to think about it"],
    },
    {
      id: "followup_branch",
      type: "branch",
      branches: [
        { variable: "resolved", operator: "eq", value: true, targetStepId: "resolved" },
        { variable: "resolved", operator: "eq", value: false, targetStepId: "escalate_step" },
      ],
    },
    {
      id: "resolved",
      type: "message",
      template: "Great! Would you like to go ahead and schedule your {{serviceType}}?",
    },
    {
      id: "escalate_step",
      type: "escalate",
      template: "Let me connect you with someone who can answer your specific questions in detail.",
      escalationReason: "Patient objection not resolved by automated response",
    },
  ],
};
