import { z } from "zod";

export const LegacyRevenueEventSourceSchema = z.enum([
  "manual",
  "chat",
  "batch",
  "pos_sync",
  "stripe",
  "crm_sync",
  "api",
]);

export type LegacyRevenueEventSource = z.infer<typeof LegacyRevenueEventSourceSchema>;

export const LegacyRevenueEventSchema = z.object({
  contactId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  source: LegacyRevenueEventSourceSchema.default("manual"),
  reference: z.string().optional(),
  recordedBy: z.string().min(1),
  timestamp: z.string().datetime().optional(),
});

export type LegacyRevenueEvent = z.infer<typeof LegacyRevenueEventSchema>;
