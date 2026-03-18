import { z } from "zod";

export const RevenueEventSourceSchema = z.enum([
  "manual",
  "chat",
  "batch",
  "pos_sync",
  "stripe",
  "crm_sync",
  "api",
]);

export type RevenueEventSource = z.infer<typeof RevenueEventSourceSchema>;

export const RevenueEventSchema = z.object({
  contactId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  source: RevenueEventSourceSchema.default("manual"),
  reference: z.string().optional(),
  recordedBy: z.string().min(1),
  timestamp: z.string().datetime().optional(),
});

export type RevenueEvent = z.infer<typeof RevenueEventSchema>;
