/** ROAS / return ratio as "N.Nx". Canonical formatter for the managed-comparison widget. */
export function fmtRatio(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(2)}×`;
}
