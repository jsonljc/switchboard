import { z } from "zod";

export const HomeFreshnessSchema = z.object({
  generatedAt: z.string().datetime(),
  window: z.literal("week"),
  dataSource: z.enum(["live", "fixture"]),
});
export type HomeFreshness = z.infer<typeof HomeFreshnessSchema>;

// A tile carries its own state so the UI renders from the contract, never from
// ad-hoc {data,error} interpretation. `value` (and the comparator value) are the
// caller's unit: cents for money, a count for bookings. v1 has no sparkline.
function homeSummaryMetric<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("state", [
    z.object({
      state: z.literal("ready"),
      value,
      comparator: z.object({ window: z.literal("week"), value }).optional(),
      freshness: HomeFreshnessSchema,
    }),
    z.object({
      state: z.literal("empty"),
      reason: z.enum(["no_current_week_bookings", "booked_value_pending"]),
    }),
    z.object({ state: z.literal("unavailable"), reason: z.string() }),
  ]);
}

const CentsMetricSchema = homeSummaryMetric(z.number().int());
const CountMetricSchema = homeSummaryMetric(z.number().int().min(0));

export const HomeSummarySchema = z.object({
  // CENTS. The dashboard performs the single /100 conversion at render.
  attributedValueCents: CentsMetricSchema,
  bookings: CountMetricSchema,
  currency: z.literal("SGD"),
  generatedAt: z.string().datetime(),
});

export type HomeSummary = z.infer<typeof HomeSummarySchema>;
export type HomeSummaryCentsMetric = z.infer<typeof CentsMetricSchema>;
export type HomeSummaryCountMetric = z.infer<typeof CountMetricSchema>;
