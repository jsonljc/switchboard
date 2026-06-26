import {
  createDepositLinkToolFactory,
  type DepositLinkToolFactory,
} from "@switchboard/core/skill-runtime";
import type { SupportedCurrency } from "@switchboard/schemas";
import type { PaymentPortFactory } from "./payment-port-factory.js";

/**
 * Pilot deposit: a fixed nominal hold (50 in the clinic's currency). The pilot
 * (SG/MY medspa, 10 to 15 clinics, the willingness-to-pay demo) uses a uniform
 * nominal deposit, so a constant is the lowest-friction honest choice.
 * OrganizationConfig carries NO deposit field today; per-org or per-service
 * pricing is the documented evolution and, because the tool takes the amount as an
 * injected dep, is a one-line change here with no tool edit. The CURRENCY is no
 * longer a constant: it is resolved per-request from the clinic's market (see
 * `resolveCurrency` below), so a MY clinic charges MYR and an SG clinic SGD.
 */
export const PILOT_DEPOSIT_AMOUNT_CENTS = 5000;

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
   * Resolves the durable booking row by id. `PrismaBookingStore.findById` is now org-scoped
   * (it takes orgId), so this lookup is keyed by org; the adapter below keeps an explicit
   * tenant check as a redundant second barrier (defense-in-depth).
   */
  findBookingById: (orgId: string, bookingId: string) => Promise<BookingRow | null>;
  /** Test override; defaults to the pilot constant. */
  depositAmountCents?: number;
  /**
   * Resolves the clinic's settlement currency from its market, keyed by deploymentId.
   * Wired to the governanceConfigResolver in skill-mode.ts; the tool fails closed when
   * this returns null (unknown market -> no charge).
   */
  resolveCurrency: (deploymentId: string) => Promise<SupportedCurrency | null>;
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
      const booking = await deps.findBookingById(orgId, bookingId);
      // Defense-in-depth: the store is org-scoped, but keep an explicit tenant check so the
      // deposit tool's isolation never silently depends on the store query shape.
      if (!booking || booking.organizationId !== orgId) return null;
      return { id: booking.id, organizationId: booking.organizationId, status: booking.status };
    },
    depositAmountCents: deps.depositAmountCents ?? PILOT_DEPOSIT_AMOUNT_CENTS,
    resolveCurrency: deps.resolveCurrency,
  });
}
