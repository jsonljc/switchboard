// Injected-dependency and store-subset types for the calendar-book tool. Split out
// of calendar-book.ts to keep that file under the 600-line ceiling; these are pure
// declarations (no behaviour), imported back by calendar-book.ts and re-exported
// from it so existing import sites keep resolving the public types unchanged.
import type {
  CalendarProvider,
  AttributionChain,
  PlaybookService,
  SupportedCurrency,
  ReceiptTier,
} from "@switchboard/schemas";
import type { ConsentPrecondition } from "./calendar-book-consent.js";
import type { BookingFailureHandler } from "./booking-failure-handler.js";

export interface BookingStoreSubset {
  create(input: {
    organizationId: string;
    contactId: string;
    opportunityId?: string | null;
    service: string;
    startsAt: Date;
    endsAt: Date;
    timezone?: string;
    attendeeName?: string | null;
    attendeeEmail?: string | null;
    createdByType?: string;
    sourceChannel?: string | null;
    workTraceId?: string | null;
  }): Promise<{ id: string }>;
  findBySlot(
    orgId: string,
    contactId: string,
    service: string,
    startsAt: Date,
  ): Promise<{ id: string } | null>;
  findUpcomingByContact(
    orgId: string,
    contactId: string,
  ): Promise<
    Array<{
      id: string;
      calendarEventId: string | null;
      service: string;
      startsAt: Date;
      endsAt: Date;
      status: string;
    }>
  >;
  reschedule(
    orgId: string,
    bookingId: string,
    slot: { startsAt: Date; endsAt: Date },
  ): Promise<unknown>;
  cancel(orgId: string, bookingId: string): Promise<unknown>;
}

export interface OpportunityStoreSubset {
  findActiveByContact(
    orgId: string,
    contactId: string,
  ): Promise<{ id: string; estimatedValue?: number | null } | null>;
  create(input: { organizationId: string; contactId: string; service: string }): Promise<{
    id: string;
  }>;
}

export type TransactionFn = (
  fn: (tx: {
    booking: {
      // Status-guarded confirm CAS (see calendar-book.ts): updateMany so the WHERE can require
      // status: "pending_confirmation", and count===0 signals the row was terminalized mid-confirm.
      updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }>;
    };
    outboxEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
    opportunity: {
      updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }>;
    };
    receipt: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
    receiptedBooking: {
      findFirst(args: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }): Promise<{ id: string } | null>;
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
    contact: {
      findFirst(args: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }): Promise<{
        leadgenId?: string | null;
        sourceType?: string | null;
        firstTouchChannel?: string | null;
        consentGrantedAt?: Date | null;
        consentRevokedAt?: Date | null;
      } | null>;
    };
  }) => Promise<unknown>,
) => Promise<unknown>;

// Type duplicated locally because packages/core cannot import from apps/api.
// Structurally identical to apps/api/src/bootstrap/calendar-provider-factory.ts.
// If drift becomes a problem, hoist into @switchboard/schemas.
export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

export interface CalendarBookToolDeps {
  calendarProviderFactory: CalendarProviderFactory;
  isCalendarProviderConfigured: (provider: CalendarProvider) => boolean;
  bookingStore: BookingStoreSubset;
  opportunityStore: OpportunityStoreSubset;
  runTransaction: TransactionFn;
  failureHandler: BookingFailureHandler;
  contactStore: {
    findById(
      orgId: string,
      contactId: string,
    ): Promise<{
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      attribution?: AttributionChain | null;
    } | null>;
  };
  /**
   * Resolves the clinic's settlement currency from its market, keyed by the trusted
   * `ctx.deploymentId`. Returns null when the market cannot be resolved; the booked
   * value then abstains to a null currency (the booking still confirms). Currency is
   * a property of the market, independent of whether the service is priced, so a null
   * here means "market unknown," never "service unpriced." apps/api wires this to the
   * same governanceConfigResolver the deposit tool and the gates use.
   */
  resolveCurrency: (deploymentId: string) => Promise<SupportedCurrency | null>;
  /**
   * Maps a resolved CalendarProvider to the receipt tier that should be
   * minted for this booking. Injected by apps/api — core must not read
   * process.env directly.
   */
  receiptTierForProvider: (provider: CalendarProvider) => ReceiptTier;
  /**
   * Whether the app is running in production mode. Injected by apps/api —
   * core must not read process.env directly.
   */
  isProduction: boolean;
  /**
   * F15 — OPTIONAL flag-gated consent precondition. When omitted, booking
   * behaves exactly as before (no consent read, no block) — this preserves
   * every existing construction/test that does not pass it. When present, the
   * tool enforces consent BEFORE persisting iff the deployment's consent mode is
   * "enforce". Default mode "off" makes the gate fully inert.
   */
  consentPrecondition?: ConsentPrecondition;
  /**
   * D3-1: OPTIONAL per-org playbook services lookup. When provided, a booked
   * service is valued from the playbook's numeric price (major units -> cents) and
   * stamped onto Opportunity.estimatedValue + the booked-conversion value. When
   * omitted (tests / orgs without a playbook), booking behaves exactly as before:
   * the booked value abstains to null and the conversion records 0. Returns
   * undefined when the org has no playbook.
   */
  getServicesForOrg?: (orgId: string) => Promise<readonly PlaybookService[] | undefined>;
}
