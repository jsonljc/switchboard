// ---------------------------------------------------------------------------
// Cadence Templates — 5 default cadence definitions
// ---------------------------------------------------------------------------

import type { CadenceDefinition } from "./types.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Consultation Reminder — 3-touch SMS before consultation.
 * Trigger: consultation_booked
 */
export const consultationReminderCadence: CadenceDefinition = {
  id: "consultation-reminder",
  name: "Consultation Reminder",
  description: "3-touch SMS reminder sequence before a consultation appointment.",
  trigger: { event: "appointment_booked", stage: "consultation_booked" },
  steps: [
    {
      index: 0,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "Hi {{contactName}}, this is a reminder about your consultation on {{appointmentDate}}. Reply CONFIRM to confirm or call us to reschedule.",
      },
      delayMs: 0, // Immediately on booking
      messageTemplate: "Booking confirmation",
    },
    {
      index: 1,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "{{contactName}}, your consultation is tomorrow at {{appointmentTime}}. We look forward to seeing you!",
      },
      delayMs: DAY * -1, // This is computed relative to appointment, but for cadence we use 24hr before
      messageTemplate: "24-hour reminder",
      condition: { variable: "appointmentConfirmed", operator: "neq", value: "cancelled" },
    },
    {
      index: 2,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "{{contactName}}, your consultation starts in 2 hours at {{appointmentTime}}. See you soon!",
      },
      delayMs: 2 * HOUR, // 2 hours before (computed from appointment time)
      messageTemplate: "2-hour reminder",
      condition: { variable: "appointmentConfirmed", operator: "neq", value: "cancelled" },
    },
  ],
};

/**
 * No-Show Rebook — follows up after a no-show.
 */
export const noShowRebookCadence: CadenceDefinition = {
  id: "no-show-rebook",
  name: "No-Show Rebook",
  description: "Re-engagement sequence after a contact no-shows.",
  trigger: { event: "appointment_no_show" },
  steps: [
    {
      index: 0,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "Hi {{contactName}}, we missed you at your appointment today. Would you like to reschedule? We'd love to find a time that works better for you.",
      },
      delayMs: 2 * HOUR, // 2 hours after no-show
    },
    {
      index: 1,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "{{contactName}}, just a friendly follow-up — we have availability this week if you'd like to reschedule your consultation. Reply or call us anytime.",
      },
      delayMs: 2 * DAY, // 2 days later
      condition: { variable: "rebooked", operator: "neq", value: true },
    },
  ],
};

/**
 * Post-Treatment Follow-up — checks in after treatment.
 */
export const postTreatmentCadence: CadenceDefinition = {
  id: "post-treatment-followup",
  name: "Post-Treatment Follow-up",
  description: "Multi-step check-in sequence after treatment completion.",
  trigger: { event: "service_completed", stage: "service_completed" },
  steps: [
    {
      index: 0,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "Hi {{contactName}}, hope you're feeling great after your {{serviceType}} today! If you have any questions, don't hesitate to reach out.",
      },
      delayMs: 4 * HOUR, // 4 hours after treatment
    },
    {
      index: 1,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "{{contactName}}, it's been 3 days since your {{serviceType}}. How are you feeling? Everything looking good?",
      },
      delayMs: 3 * DAY,
    },
    {
      index: 2,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "{{contactName}}, we'd love to hear about your experience! Would you mind leaving us a quick review?",
      },
      delayMs: 7 * DAY,
      condition: { variable: "satisfaction", operator: "gt", value: 3 },
    },
  ],
};

/**
 * Review Request — solicits reviews from satisfied contacts.
 */
export const reviewRequestCadence: CadenceDefinition = {
  id: "review-request",
  name: "Review Request",
  description: "Review solicitation for contacts who haven't left a review.",
  trigger: { event: "service_completed" },
  steps: [
    {
      index: 0,
      actionType: "customer-engagement.review.request",
      parameters: {
        contactId: "{{contactId}}",
        platform: "google",
        message: "Your feedback helps others find great care!",
      },
      delayMs: 7 * DAY, // 1 week after treatment
      condition: { variable: "hasReviewed", operator: "neq", value: true },
    },
    {
      index: 1,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "{{contactName}}, we'd really appreciate your review! It only takes a minute and helps us serve you better.",
      },
      delayMs: 14 * DAY, // 2 weeks after treatment
      condition: { variable: "hasReviewed", operator: "neq", value: true },
    },
  ],
};

/**
 * Dormant Win-Back — re-engages contacts who haven't visited in 90+ days.
 */
export const dormantWinBackCadence: CadenceDefinition = {
  id: "dormant-winback",
  name: "Dormant Contact Win-Back",
  description: "Re-engagement sequence for contacts inactive for 90+ days.",
  trigger: { event: "contact_dormant", stage: "dormant" },
  steps: [
    {
      index: 0,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "Hi {{contactName}}, we haven't seen you in a while at {{clinicName}}. We'd love to welcome you back! Reply to schedule a visit.",
      },
      delayMs: 0,
    },
    {
      index: 1,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "{{contactName}}, we have some exciting new treatments that might interest you. Would you like to learn more?",
      },
      delayMs: 7 * DAY,
      condition: { variable: "responded", operator: "neq", value: true },
    },
    {
      index: 2,
      actionType: "customer-engagement.reminder.send",
      parameters: {
        contactId: "{{contactId}}",
        phoneNumber: "{{phoneNumber}}",
        message:
          "{{contactName}}, this is our last check-in for now. We're here whenever you're ready. Call or text anytime!",
      },
      delayMs: 21 * DAY,
      condition: { variable: "responded", operator: "neq", value: true },
    },
  ],
};

export const DEFAULT_CADENCE_TEMPLATES: CadenceDefinition[] = [
  consultationReminderCadence,
  noShowRebookCadence,
  postTreatmentCadence,
  reviewRequestCadence,
  dormantWinBackCadence,
];

/**
 * Resolve cadence templates: returns profile-provided templates or defaults.
 */
export function resolveCadenceTemplates(templates?: CadenceDefinition[]): CadenceDefinition[] {
  return templates ?? DEFAULT_CADENCE_TEMPLATES;
}
