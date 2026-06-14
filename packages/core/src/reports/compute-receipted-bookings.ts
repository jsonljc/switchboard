import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type { ReceiptedBookingsData } from "@switchboard/schemas";

export async function computeReceiptedBookings(
  ctx: RollupContext,
  receipts: ReportStores["receipts"],
): Promise<ReceiptedBookingsData> {
  const count = await receipts.countReceiptedBookingsInWindow({
    orgId: ctx.orgId,
    from: ctx.current.start,
    to: ctx.current.end,
  });
  return { count };
}
