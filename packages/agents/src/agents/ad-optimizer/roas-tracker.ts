// ---------------------------------------------------------------------------
// Ad Optimizer — ROAS Rolling Window Tracker
// ---------------------------------------------------------------------------

export interface ROASRecord {
  campaignId: string;
  platform: string;
  roas: number;
  spend: number;
  revenue: number;
  timestamp: string;
}

export function addROASRecord(history: ROASRecord[], record: ROASRecord): void {
  history.push(record);
}

export function getROASWindow(
  history: ROASRecord[],
  campaignId: string,
  lookbackDays: number,
): ROASRecord[] {
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return history.filter(
    (r) => r.campaignId === campaignId && new Date(r.timestamp).getTime() >= cutoff,
  );
}

/**
 * Returns true if the last `consecutiveRequired` records are all above `targetROAS`.
 */
export function shouldIncreaseBudget(
  records: ROASRecord[],
  targetROAS: number,
  consecutiveRequired = 3,
): boolean {
  if (records.length < consecutiveRequired) return false;

  const sorted = [...records].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const lastN = sorted.slice(-consecutiveRequired);
  return lastN.every((r) => r.roas > targetROAS);
}

/**
 * Returns true if the last `consecutiveRequired` records are all below `targetROAS`.
 */
export function shouldDecreaseBudget(
  records: ROASRecord[],
  targetROAS: number,
  consecutiveRequired = 3,
): boolean {
  if (records.length < consecutiveRequired) return false;

  const sorted = [...records].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const lastN = sorted.slice(-consecutiveRequired);
  return lastN.every((r) => r.roas < targetROAS);
}
