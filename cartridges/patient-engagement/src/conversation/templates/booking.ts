// ---------------------------------------------------------------------------
// Conversation Template: Booking
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../types.js";

export const bookingFlow: ConversationFlowDefinition = {
  id: "booking",
  name: "Appointment Booking",
  description: "Guides patients through the appointment booking process.",
  variables: ["patientName", "treatmentType", "providerName", "clinicName"],
  steps: [
    {
      id: "intro",
      type: "message",
      template: "Let's get your {{treatmentType}} appointment scheduled at {{clinicName}}, {{patientName}}.",
    },
    {
      id: "preference_question",
      type: "question",
      template: "Do you have a preferred day of the week?",
      options: ["Weekday morning", "Weekday afternoon", "Weekend", "Any availability"],
    },
    {
      id: "provider_question",
      type: "question",
      template: "Would you like to see a specific provider?",
      options: ["{{providerName}}", "No preference"],
    },
    {
      id: "confirm_booking",
      type: "action",
      template: "I've found a great time slot for you. Let me confirm the booking.",
      actionType: "patient-engagement.appointment.book",
      actionParameters: {
        patientId: "{{patientId}}",
        treatmentType: "{{treatmentType}}",
        providerId: "{{providerId}}",
      },
    },
    {
      id: "confirmation",
      type: "message",
      template: "Your appointment has been confirmed! You'll receive a reminder 24 hours before. Is there anything else I can help with?",
    },
  ],
};
