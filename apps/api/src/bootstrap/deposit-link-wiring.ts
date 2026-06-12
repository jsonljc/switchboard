import {
  createDepositLinkToolFactory,
  type DepositLinkToolFactory,
} from "@switchboard/core/skill-runtime";
import type { PaymentPortFactory } from "./payment-port-factory.js";

/**
 * Pilot deposit: a fixed nominal SGD 50 hold. The pilot (SG/MY medspa, 10 to 15
 * clinics, the willingness-to-pay demo) uses a uniform nominal deposit, so a
 * constant is the lowest-friction honest choice. OrganizationConfig carries NO
 * deposit field today; per-org or per-service pricing is the documented
 * evolution and, because the tool takes the amount as an injected dep, is a
 * one-line change here with no tool edit. Mirrors calendar-book's injected
 * `defaultCurrency: "SGD"` (skill-mode.ts).
 */
export const PILOT_DEPOSIT_AMOUNT_CENTS = 5000;
export const PILOT_DEPOSIT_CURRENCY = "SGD";

/** The minimal booking row the org-isolation adapter reads. */
interface BookingRow {
  id: string;
  organizationId: string;
  status: string;
}

export interface DepositLinkWiringDeps {
  /**
   * The SHARED app.paymentPortFactory instance. Sharing one instance is required:
   * the Noop adapter's in-process issued map only round-trips with the payments
   * webhook's retrievePayment when the tool and the webhook resolve the same port.
   */
  paymentPortFactory: PaymentPortFactory;
  /**
   * PrismaBookingStore.findById is org-UNAWARE (takes only bookingId). Org
   * isolation is enforced in the adapter below, never delegated to the tool.
   */
  findBookingById: (bookingId: string) => Promise<BookingRow | null>;
  /** Test override; defaults to the pilot constant. */
  depositAmountCents?: number;
  /** Test override; defaults to the pilot currency. */
  defaultCurrency?: string;
}

/**
 * Builds the registered `deposit-link` tool factory. Bridges the org-unaware
 * booking store to the tool's org-scoped findById(orgId, bookingId) contract,
 * enforcing tenant isolation here: a booking belonging to another org is filtered
 * to null (surfaces as MISSING_BOOKING), never crossing the boundary. `orgId` is
 * the trusted `ctx.orgId` inside the tool (AI-1), never a tool param.
 */
export function buildDepositLinkToolFactory(deps: DepositLinkWiringDeps): DepositLinkToolFactory {
  return createDepositLinkToolFactory({
    paymentPortFactory: deps.paymentPortFactory,
    findById: async (orgId: string, bookingId: string) => {
      const booking = await deps.findBookingById(bookingId);
      if (!booking || booking.organizationId !== orgId) return null;
      return { id: booking.id, organizationId: booking.organizationId, status: booking.status };
    },
    depositAmountCents: deps.depositAmountCents ?? PILOT_DEPOSIT_AMOUNT_CENTS,
    defaultCurrency: deps.defaultCurrency ?? PILOT_DEPOSIT_CURRENCY,
  });
}
