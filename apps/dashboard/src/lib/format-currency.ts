/**
 * Currency formatting utility.
 *
 * Reads the org's configured currency code (ISO 4217). Falls back to "SGD"
 * when no org config is available yet.
 */

const DEFAULT_CURRENCY = "SGD";

/**
 * Format a numeric amount as a currency string using Intl.NumberFormat.
 * @param amount  The numeric value to format
 * @param currency  ISO 4217 currency code (e.g. "SGD", "USD", "MYR")
 */
export function formatOrgCurrency(amount: number, currency: string = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format with decimals for precise amounts.
 */
export function formatOrgCurrencyPrecise(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
