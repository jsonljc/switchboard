/** Money formatting helpers for /reports. */

export function fmtMoney(n: number, opts: { cents?: boolean } = {}): string {
  const { cents = false } = opts;
  if (cents) {
    return (
      "$" +
      n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return "$" + Math.round(n).toLocaleString("en-US");
}
