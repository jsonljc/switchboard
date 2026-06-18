export interface RecoveryCandidateInput {
  bookingId: string;
  contactId: string;
  service: string;
  startsAt: Date;
  attendeeName: string | null;
}

/**
 * Pure, deterministic selection of the no-show recovery cohort. Drops contacts who already hold a
 * future booking (they self-rebooked, no recovery needed) and de-duplicates to one attempt per
 * contact (keeps the first in input order; the caller orders by startsAt). The future-booking set
 * is supplied by the caller (a batched org-scoped read lands with the cron slice). No I/O, no Date
 * math, NaN-free.
 */
export function selectRecoveryCandidates(
  candidates: RecoveryCandidateInput[],
  opts: { existingFutureBookingContactIds: ReadonlySet<string> },
): RecoveryCandidateInput[] {
  const seen = new Set<string>();
  const out: RecoveryCandidateInput[] = [];
  for (const candidate of candidates) {
    if (opts.existingFutureBookingContactIds.has(candidate.contactId)) continue;
    if (seen.has(candidate.contactId)) continue;
    seen.add(candidate.contactId);
    out.push(candidate);
  }
  return out;
}
