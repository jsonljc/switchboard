/**
 * Convert an internal conversion value (MINOR units / cents) to the MAJOR
 * currency units the Meta Conversions API expects.
 *
 * `ConversionEvent.value` is stored in cents system-wide (consistent with
 * Opportunity.estimatedValue and the funnel revenue sums). This conversion is
 * applied ONLY at the Meta dispatch boundary — never to the stored/summed value.
 */
export function normalizeConversionValue(minorUnits: number): number {
  return minorUnits / 100;
}
