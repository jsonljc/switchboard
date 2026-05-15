export function formatNumericDelta(current: number, prev: number): string {
  const diff = current - prev;
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `${diff}`;
  return "0";
}

export function formatPercentPointsDelta(current: number, prev: number | null): string | null {
  if (prev === null) return null;
  const diff = current - prev;
  if (diff > 0) return `+${diff} pts`;
  if (diff < 0) return `${diff} pts`;
  return "0 pts";
}
