import { LocalCalendarProvider } from "@switchboard/core/calendar";
import type { CalendarProvider, ReceiptTier } from "@switchboard/schemas";
import { isNoopCalendarProvider } from "./noop-calendar-provider.js";

/**
 * R1: Noop and Local calendar providers fabricate event ids, so a receipt minted
 * from one can never be production-countable — clamp to T3_ADMIN_AUDIT. A real
 * provider (e.g. Google) yields a fetch-back-verifiable event id → T1_FETCH_BACK.
 * Uses `instanceof` (not `constructor.name`) so a wrapped/renamed/subclassed
 * provider cannot silently leak a fabricated-id provider into a countable tier.
 */
export function receiptTierForCalendarProvider(provider: CalendarProvider): ReceiptTier {
  if (isNoopCalendarProvider(provider) || provider instanceof LocalCalendarProvider) {
    return "T3_ADMIN_AUDIT";
  }
  return "T1_FETCH_BACK";
}
