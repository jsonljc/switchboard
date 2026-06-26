/**
 * Convert minor currency units (cents) to MAJOR units (dollars).
 *
 * The report layer is canonically major-unit (see `PaidVisitRow.amountMajor` in
 * schemas/reports/v1.ts: "the API converts the stored cents EXACTLY ONCE"). Revenue
 * read from the revenue store is MINOR-unit — `LifecycleRevenueEvent.amount` is cents
 * per schemas/conversion.ts — while Meta ad spend is already MAJOR-unit (dollars).
 *
 * Revenue must therefore be normalized ONCE, here, at the rollup boundary before it is
 * divided by spend (ROAS) or rendered via `formatMoneyMajor`. Mixing the two units
 * inflates both revenue and ROAS by 100x.
 */
export function centsToMajorUnits(cents: number): number {
  return cents / 100;
}
