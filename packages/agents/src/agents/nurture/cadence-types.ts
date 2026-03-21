// ---------------------------------------------------------------------------
// Nurture Agent — Cadence type definitions
// ---------------------------------------------------------------------------

export interface CadenceStep {
  /** Hours to delay from cadence start (or previous step) */
  delayHours: number;
  /** Template key for LLM prompt context */
  templateKey: string;
  /** Fallback static message if LLM is not available */
  fallbackMessage: string;
}

export interface CadenceConfig {
  cadenceType: string;
  description: string;
  steps: CadenceStep[];
  /** Default delay in days before first step (for deferred cadences like review) */
  defaultDelayDays?: number;
  /** Days of inactivity that trigger this cadence */
  triggerAfterDays?: number;
}

export const CADENCE_TYPES: Record<string, CadenceConfig> = {
  "consultation-reminder": {
    cadenceType: "consultation-reminder",
    description: "Appointment reminders: 24h before and 2h before",
    steps: [
      {
        delayHours: 0,
        templateKey: "reminder-24h",
        fallbackMessage: "Reminder: Your consultation is tomorrow. We look forward to seeing you!",
      },
      {
        delayHours: 22,
        templateKey: "reminder-2h",
        fallbackMessage: "Your appointment is in 2 hours. See you soon!",
      },
    ],
  },
  "no-show-recovery": {
    cadenceType: "no-show-recovery",
    description: "Same-day and 3-day rebook offer after a no-show",
    steps: [
      {
        delayHours: 2,
        templateKey: "noshow-sameday",
        fallbackMessage:
          "We missed you today! Would you like to reschedule? We have availability this week.",
      },
      {
        delayHours: 72,
        templateKey: "noshow-3day",
        fallbackMessage:
          "Hi! We'd love to get you rebooked. Reply to find a time that works for you.",
      },
    ],
  },
  "post-treatment-review": {
    cadenceType: "post-treatment-review",
    description: "Day 7 review request with platform link",
    defaultDelayDays: 7,
    steps: [
      {
        delayHours: 0,
        templateKey: "review-request",
        fallbackMessage:
          "We hope you're loving your results! If you have a moment, we'd appreciate a review.",
      },
    ],
  },
  "cold-lead-winback": {
    cadenceType: "cold-lead-winback",
    description: "Reactivation offer for leads inactive 30+ days",
    triggerAfterDays: 30,
    steps: [
      {
        delayHours: 0,
        templateKey: "winback-offer",
        fallbackMessage:
          "Hi! It's been a while. We have some exciting new treatments and offers — interested in hearing more?",
      },
    ],
  },
  "dormant-client": {
    cadenceType: "dormant-client",
    description: "Re-engagement for clients inactive 60+ days",
    triggerAfterDays: 60,
    steps: [
      {
        delayHours: 0,
        templateKey: "dormant-reengage",
        fallbackMessage:
          "We miss you! It's been a while since your last visit. Would you like to book a treatment?",
      },
    ],
  },
};

export function getCadenceConfig(cadenceType: string): CadenceConfig | undefined {
  return CADENCE_TYPES[cadenceType];
}
