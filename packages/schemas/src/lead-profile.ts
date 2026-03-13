// ---------------------------------------------------------------------------
// Lead Profile Schema — typed lead intelligence that accumulates over turns
// ---------------------------------------------------------------------------

import { z } from "zod";

export const TimelineEnum = z.enum([
  "immediate", // within 1-2 weeks
  "soon", // within 1-3 months
  "exploring", // no specific timeline
  "unknown",
]);
export type Timeline = z.infer<typeof TimelineEnum>;

export const PriceReadinessEnum = z.enum([
  "ready", // has budget, ready to pay
  "flexible", // open to financing or payment plans
  "price_sensitive", // cost is a major concern
  "unknown",
]);
export type PriceReadiness = z.infer<typeof PriceReadinessEnum>;

export const ObjectionEntrySchema = z.object({
  category: z.string(),
  raisedAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable().optional(),
});
export type ObjectionEntry = z.infer<typeof ObjectionEntrySchema>;

export const LeadProfileSchema = z.object({
  /** Service/treatment the lead is interested in */
  treatmentInterest: z.string().nullable().optional(),
  /** How soon the lead wants to proceed */
  timeline: TimelineEnum.optional(),
  /** Lead's readiness to invest */
  priceReadiness: PriceReadinessEnum.optional(),
  /** Objections raised during conversation */
  objectionsRaised: z.array(ObjectionEntrySchema).optional(),
  /** Whether the qualification flow is complete */
  qualificationComplete: z.boolean().optional(),
  /** Preferred provider/staff member */
  preferredProvider: z.string().nullable().optional(),
  /** Source of the lead (ad, referral, organic, etc.) */
  source: z.string().nullable().optional(),
  /** Custom signals extracted from conversation */
  signals: z.record(z.string(), z.unknown()).optional(),
});
export type LeadProfile = z.infer<typeof LeadProfileSchema>;
