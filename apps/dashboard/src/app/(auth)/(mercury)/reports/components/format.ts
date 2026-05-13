// Money / int / percent formatters for /reports.
// Currency is SGD; backend emits whole dollars (with optional decimals), NOT cents.
// Threshold rule matches packages/core/src/reports/period-helpers.ts formatCurrencySGD:
//   abs >= 1000          → whole rounded
//   abs < 1000 + integer → integer
//   abs < 1000 + frac.   → two decimals

export interface FmtSGDOptions {
  withCents?: "auto" | "always" | "never";
  compact?: boolean;
}

export function fmtSGD(value: number | null | undefined, opts: FmtSGDOptions = {}): string {
  if (value == null) return "—";
  const { withCents = "auto", compact = false } = opts;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (compact && abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}S$${m.toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (compact && abs >= 10_000) {
    return `${sign}S$${Math.round(abs / 1_000)}k`;
  }

  let showCents: boolean;
  if (withCents === "always") showCents = true;
  else if (withCents === "never") showCents = false;
  else if (abs >= 1000) showCents = false;
  else showCents = !Number.isInteger(abs);

  return `${sign}S$${abs.toLocaleString("en-SG", {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  })}`;
}

export function fmtInt(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-SG");
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * @deprecated Used by v1 components (header/title-controls/report-footer/disclosure/
 * attribution/campaigns/cost-vs-value). Removed in Task 19 when those components are
 * deleted. New code uses fmtSGD.
 */
export function fmtMoney(n: number, opts: { cents?: boolean } = {}): string {
  const { cents = false } = opts;
  if (cents) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "$" + Math.round(n).toLocaleString("en-US");
}
