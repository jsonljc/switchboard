// ---------------------------------------------------------------------------
// Revenue Gap Checker — Finds completed appointments without revenue records
// ---------------------------------------------------------------------------

export interface CompletedDeal {
  id: string;
  name: string;
  stage: string;
  contactIds: string[];
  closeDate: string;
  amount: number;
}

export interface RevenueGap {
  dealId: string;
  dealName: string;
  contactIds: string[];
  amount: number;
  completedAt: string;
}

export interface GapCheckerOptions {
  graceHours: number;
}

/**
 * Find completed appointments/deals that don't have a corresponding revenue event.
 *
 * @param deals - Deals in completed stages
 * @param recordedContactIds - Contact IDs that already have revenue events recorded
 * @param options - Configuration (grace period)
 */
export async function findUnrecordedAppointments(
  deals: CompletedDeal[],
  recordedContactIds: string[],
  options: GapCheckerOptions,
): Promise<RevenueGap[]> {
  const graceMs = options.graceHours * 60 * 60 * 1000;
  const cutoff = Date.now() - graceMs;
  const recordedSet = new Set(recordedContactIds);

  const gaps: RevenueGap[] = [];

  for (const deal of deals) {
    const closeTime = new Date(deal.closeDate).getTime();

    // Skip if within grace period
    if (closeTime > cutoff) continue;

    // Skip if any contact already has revenue recorded
    const hasRevenue = deal.contactIds.some((cid) => recordedSet.has(cid));
    if (hasRevenue) continue;

    gaps.push({
      dealId: deal.id,
      dealName: deal.name,
      contactIds: deal.contactIds,
      amount: deal.amount,
      completedAt: deal.closeDate,
    });
  }

  return gaps;
}
