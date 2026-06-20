// Int / percent formatters for /reports. Money formatting now lives in the
// shared canonical `@/lib/money` (formatMoney); `fmtSGD` / `FmtSGDOptions` are
// re-exported here as aliases so existing reports + results call sites keep
// working unchanged (byte-identical output).

export { formatMoney as fmtSGD, type MoneyOptions as FmtSGDOptions } from "@/lib/money";

export function fmtInt(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-SG");
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}
