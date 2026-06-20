import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Canonical money formatter for the dashboard. Currency is SGD; inputs are
 * WHOLE DOLLARS (not cents). Promoted from reports' `fmtSGD` (the proven,
 * hero-`$$`-bug-hardened formatter) so the whole app shares one locale-aware
 * source instead of the prior 8 divergent formatters.
 *
 *   abs >= 1000          -> whole rounded
 *   abs < 1000 + integer -> integer
 *   abs < 1000 + frac.   -> two decimals
 *
 * Threshold rule matches packages/core/src/reports/period-helpers.ts
 * formatCurrencySGD.
 */
export interface MoneyOptions {
  withCents?: "auto" | "always" | "never";
  compact?: boolean;
}

export function formatMoney(value: number | null | undefined, opts: MoneyOptions = {}): string {
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

export interface MoneyProps extends MoneyOptions {
  value: number | null | undefined;
  className?: string;
}

/**
 * Render a money value through the canonical formatter. Uses tabular figures so
 * columns of amounts line up. This is the single `<Money>` primitive the rest
 * of the app migrates onto (the ~90 ad-hoc render sites land in follow-ups).
 */
export function Money({ value, className, ...opts }: MoneyProps) {
  return <span className={cn("tabular-nums", className)}>{formatMoney(value, opts)}</span>;
}
