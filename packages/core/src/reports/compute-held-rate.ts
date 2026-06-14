import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type { HeldRateData } from "@switchboard/schemas";

export async function computeHeldRate(
  ctx: RollupContext,
  bookings: ReportStores["bookings"],
): Promise<HeldRateData> {
  const { matured, attended } = await bookings.countMaturedAttendance({
    orgId: ctx.orgId,
    from: ctx.current.start,
    to: ctx.current.end,
    now: ctx.computedAt,
  });
  return { attended, matured, rate: matured > 0 ? attended / matured : null };
}
