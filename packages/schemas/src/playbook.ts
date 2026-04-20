import { z } from "zod";

export const PlaybookSectionStatus = z.enum(["ready", "check_this", "missing"]);
export type PlaybookSectionStatus = z.infer<typeof PlaybookSectionStatus>;

export const PlaybookSource = z.enum(["scan", "interview", "manual"]);
export type PlaybookSource = z.infer<typeof PlaybookSource>;

export const BookingBehavior = z.enum(["book_directly", "consultation_only", "ask_first"]);
export type BookingBehavior = z.infer<typeof BookingBehavior>;

export const BookingApproval = z.enum([
  "book_then_notify",
  "ask_before_booking",
  "book_if_open_ask_if_odd",
]);
export type BookingApproval = z.infer<typeof BookingApproval>;

export const PricingApproval = z.enum([
  "quote_from_playbook",
  "describe_but_confirm_pricing",
  "always_ask_before_pricing",
  "share_if_in_playbook",
]);
export type PricingApproval = z.infer<typeof PricingApproval>;

export const PlaybookServiceSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  price: z.number().optional(),
  duration: z.number().optional(),
  bookingBehavior: BookingBehavior.default("ask_first"),
  details: z.string().optional(),
  status: PlaybookSectionStatus,
  source: PlaybookSource,
});
export type PlaybookService = z.infer<typeof PlaybookServiceSchema>;

export const PlaybookSchema = z.object({
  businessIdentity: z.object({
    name: z.string().default(""),
    category: z.string().default(""),
    tagline: z.string().default(""),
    location: z.string().default(""),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  services: z.array(PlaybookServiceSchema).default([]),
  hours: z.object({
    timezone: z.string().default(""),
    schedule: z.record(z.string()).default({}),
    afterHoursBehavior: z.string().default(""),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  bookingRules: z.object({
    leadVsBooking: z.string().default(""),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  approvalMode: z.object({
    bookingApproval: BookingApproval.optional(),
    pricingApproval: PricingApproval.optional(),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  escalation: z.object({
    triggers: z.array(z.string()).default([]),
    toneBoundaries: z.string().default(""),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  channels: z.object({
    recommended: z.string().optional(),
    configured: z.array(z.string()).default([]),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

export const PlaybookReadinessSchema = z.object({
  businessIdentity: PlaybookSectionStatus,
  services: PlaybookSectionStatus,
  hours: PlaybookSectionStatus,
  bookingRules: PlaybookSectionStatus,
  approvalMode: PlaybookSectionStatus,
});
export type PlaybookReadiness = z.infer<typeof PlaybookReadinessSchema>;

export const REQUIRED_SECTIONS = [
  "businessIdentity",
  "services",
  "hours",
  "bookingRules",
  "approvalMode",
] as const;

export const RECOMMENDED_SECTIONS = ["escalation", "channels"] as const;

export function getPlaybookReadiness(playbook: Playbook): PlaybookReadiness {
  return {
    businessIdentity: playbook.businessIdentity.status,
    services:
      playbook.services.length > 0 && playbook.services.some((s) => s.status === "ready")
        ? "ready"
        : playbook.services.length > 0
          ? "check_this"
          : "missing",
    hours: playbook.hours.status,
    bookingRules: playbook.bookingRules.status,
    approvalMode: playbook.approvalMode.status,
  };
}

export function isPlaybookReady(playbook: Playbook): boolean {
  const readiness = getPlaybookReadiness(playbook);
  return Object.values(readiness).every((s) => s === "ready");
}

export function createEmptyPlaybook(): Playbook {
  const base = { status: "missing" as const, source: "manual" as const };
  return {
    businessIdentity: { name: "", category: "", tagline: "", location: "", ...base },
    services: [],
    hours: { timezone: "", schedule: {}, afterHoursBehavior: "", ...base },
    bookingRules: { leadVsBooking: "", ...base },
    approvalMode: { ...base },
    escalation: { triggers: [], toneBoundaries: "", ...base },
    channels: { configured: [], ...base },
  };
}
