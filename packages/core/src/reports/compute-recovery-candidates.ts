import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type { RecoveryCandidatesData } from "@switchboard/schemas";

export async function computeRecoveryCandidates(
  ctx: RollupContext,
  bookings: ReportStores["bookings"],
): Promise<RecoveryCandidatesData> {
  const noShows = await bookings.countNoShowsInWindow({
    orgId: ctx.orgId,
    from: ctx.current.start,
    to: ctx.current.end,
  });
  return { noShows };
}
