/**
 * In-memory persistence substrate for the whole-loop revenue-proof e2e
 * (decomposition plan: docs/superpowers/plans/2026-06-21-revenue-proof-e2e-decomposition.md).
 *
 * CI has no Postgres, so the write legs (the calendar-book tx) and the read legs (the
 * PrismaReceiptStore / PrismaReceiptedBookingStore projections) must share ONE stateful substrate, so
 * the test proves "the booking write produces the owner read" rather than proving a readonly fixture.
 * This is the only mocked edge on the data plane: every producer and projection that runs against it is
 * production code.
 *
 * Fidelity points it MUST honor or it would prove the fake, not the loop (see the plan):
 *  - `receipt.create` stamps `createdAt = data.createdAt ?? new Date()` (the real schema defaults it via
 *    @default(now()) and buildCalendarReceiptData does NOT set it; the cohort window keys on createdAt).
 *  - `receipt.findMany` honors the cohort WHERE (org, kind, `status in`, `createdAt` range,
 *    `bookingId not null`) plus `distinct: ["bookingId"]`, so the count and cohort genuinely filter
 *    (the e2e seeds decoys that every clause must drop).
 *  - `opportunity.updateMany` honors `where` (id, org, `stage notIn`) and returns `{ count }`.
 *  - every read is org-scoped, mirroring the F12 IDOR posture the real stores enforce.
 *
 * Reused by slices 2-3 (attendance + payment, digest + delivery).
 */
import { createCalendarBookToolFactory } from "@switchboard/core/skill-runtime";

type Row = Record<string, unknown>;

export interface ContactSeed {
  id: string;
  organizationId: string;
  leadgenId?: string | null;
  sourceType?: string | null;
  firstTouchChannel?: string | null;
  pdpaJurisdiction?: string | null;
  consentGrantedAt?: Date | null;
  consentRevokedAt?: Date | null;
  name?: string | null;
  email?: string | null;
}

export interface OpportunitySeed {
  id: string;
  organizationId: string;
  contactId: string;
  estimatedValue: number | null;
  stage: string;
}

export interface BookingSeed {
  id: string;
  organizationId: string;
  contactId: string | null;
  opportunityId: string | null;
  service: string;
  startsAt: Date;
  attendance?: string | null;
  workTraceId?: string | null;
}

export interface ReceiptSeed {
  id: string;
  organizationId: string;
  kind: string;
  status: string;
  bookingId: string | null;
  createdAt: Date;
  tier?: string;
  provider?: string | null;
  amount?: number | null;
}

/** Date range comparison (gte/gt/lt/lte). The real stores only range-filter on Date columns. */
function matchRange(value: unknown, cond: Row): boolean {
  const t = value instanceof Date ? value.getTime() : NaN;
  if ("gte" in cond && !(t >= (cond["gte"] as Date).getTime())) return false;
  if ("gt" in cond && !(t > (cond["gt"] as Date).getTime())) return false;
  if ("lt" in cond && !(t < (cond["lt"] as Date).getTime())) return false;
  if ("lte" in cond && !(t <= (cond["lte"] as Date).getTime())) return false;
  return true;
}

/** Evaluate one Prisma-style operator object against a value. Throws on any operator the real stores
 *  do not use yet, so a future store leg that relies on an unmodeled operator fails LOUDLY here rather
 *  than silently reading zero rows (a false-green foot-gun for slices 2-3). */
function matchOperator(value: unknown, cond: Row): boolean {
  if ("in" in cond) return (cond["in"] as unknown[]).includes(value);
  if ("notIn" in cond) return !(cond["notIn"] as unknown[]).includes(value);
  if ("not" in cond) {
    return cond["not"] === null ? value !== null && value !== undefined : value !== cond["not"];
  }
  if ("gte" in cond || "gt" in cond || "lt" in cond || "lte" in cond) {
    return matchRange(value, cond);
  }
  throw new Error(
    `revenue-loop-substrate: unsupported where operator in ${JSON.stringify(cond)} (model it before use)`,
  );
}

/** Minimal Prisma-style condition match supporting only the operators the real stores use. */
function matchWhere(row: Row, where?: Row): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    const value = row[key];
    if (cond !== null && typeof cond === "object") {
      if (!matchOperator(value, cond as Row)) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

function applyDistinct(rows: Row[], distinct?: readonly string[]): Row[] {
  if (!distinct || distinct.length === 0) return rows;
  const seen = new Set<string>();
  return rows.filter((r) => {
    const composite = distinct.map((f) => String(r[f])).join("|");
    if (seen.has(composite)) return false;
    seen.add(composite);
    return true;
  });
}

interface SkillRequestContextLike {
  sessionId: string;
  orgId: string;
  deploymentId: string;
  contactId: string;
  workUnitId?: string | null;
}

export class InMemoryRevenueDb {
  private bookings = new Map<string, Row>();
  private opportunities = new Map<string, Row>();
  private contacts = new Map<string, Row>();
  private receipts: Row[] = [];
  private receiptedBookings = new Map<string, Row>();
  private outbox: Row[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  // --- seed helpers (the test sets up the world) ---

  seedContact(contact: ContactSeed): void {
    this.contacts.set(contact.id, { ...contact });
  }

  seedOpportunity(opportunity: OpportunitySeed): void {
    this.opportunities.set(opportunity.id, { ...opportunity });
  }

  seedBooking(booking: BookingSeed): void {
    this.bookings.set(booking.id, {
      attendance: null,
      workTraceId: null,
      ...booking,
    });
  }

  seedReceipt(receipt: ReceiptSeed): void {
    this.receipts.push({ ...receipt });
  }

  // --- snapshot accessors (write-leg assertions) ---

  listReceipts(): Array<Row & { createdAt: Date; bookingId: string | null }> {
    return this.receipts.slice() as Array<Row & { createdAt: Date; bookingId: string | null }>;
  }

  getReceiptedBooking(bookingId: string): Row | undefined {
    return this.receiptedBookings.get(bookingId);
  }

  getBooking(id: string): Row | undefined {
    return this.bookings.get(id);
  }

  // --- store-subset adapters consumed by the calendar-book tool deps ---

  private bookingStoreAdapter() {
    return {
      create: async (input: Row): Promise<{ id: string }> => {
        const id = this.id("bk");
        this.bookings.set(id, {
          status: "pending_confirmation",
          attendance: null,
          calendarEventId: null,
          ...input,
          id,
        });
        return { id };
      },
      findBySlot: async (): Promise<{ id: string } | null> => null,
      findUpcomingByContact: async (): Promise<unknown[]> => [],
      reschedule: async (): Promise<unknown> => ({}),
      cancel: async (): Promise<unknown> => ({}),
    };
  }

  private opportunityStoreAdapter() {
    return {
      findActiveByContact: async (
        orgId: string,
        contactId: string,
      ): Promise<{ id: string; estimatedValue?: number | null } | null> => {
        for (const o of this.opportunities.values()) {
          if (o["organizationId"] === orgId && o["contactId"] === contactId) {
            return { id: o["id"] as string, estimatedValue: o["estimatedValue"] as number | null };
          }
        }
        return null;
      },
      create: async (input: Row): Promise<{ id: string }> => {
        const id = this.id("opp");
        this.opportunities.set(id, { stage: "new", estimatedValue: null, ...input, id });
        return { id };
      },
    };
  }

  private contactStoreAdapter() {
    return {
      findById: async (
        _orgId: string,
        contactId: string,
      ): Promise<{
        name?: string | null;
        email?: string | null;
        phone?: string | null;
        attribution?: null;
      } | null> => {
        const c = this.contacts.get(contactId);
        if (!c) return null;
        return {
          name: (c["name"] as string) ?? null,
          email: (c["email"] as string) ?? null,
          phone: null,
          attribution: null,
        };
      },
    };
  }

  /** Prisma-shaped client used as BOTH the booking tx and the read projections' `prisma`. */
  get client() {
    const values = (m: Map<string, Row>): Row[] => Array.from(m.values());
    return {
      booking: {
        findFirst: async (args: { where?: Row }): Promise<Row | null> =>
          values(this.bookings).find((r) => matchWhere(r, args.where)) ?? null,
        update: async (args: { where: { id: string }; data: Row }): Promise<Row> => {
          const row = this.bookings.get(args.where.id);
          if (row) Object.assign(row, args.data);
          return row ?? {};
        },
      },
      receipt: {
        findFirst: async (args: { where?: Row }): Promise<Row | null> =>
          this.receipts.find((r) => matchWhere(r, args.where)) ?? null,
        findMany: async (args: { where?: Row; distinct?: readonly string[] }): Promise<Row[]> =>
          applyDistinct(
            this.receipts.filter((r) => matchWhere(r, args.where)),
            args.distinct,
          ),
        create: async (args: { data: Row }): Promise<Row> => {
          const data = args.data;
          const row: Row = {
            ...data,
            id: (data["id"] as string) ?? this.id("rcpt"),
            createdAt: (data["createdAt"] as Date) ?? new Date(),
          };
          this.receipts.push(row);
          return row;
        },
        updateMany: async (args: { where?: Row; data: Row }): Promise<{ count: number }> => {
          let count = 0;
          for (const r of this.receipts) {
            if (matchWhere(r, args.where)) {
              Object.assign(r, args.data);
              count += 1;
            }
          }
          return { count };
        },
      },
      opportunity: {
        findFirst: async (args: { where?: Row }): Promise<Row | null> =>
          values(this.opportunities).find((r) => matchWhere(r, args.where)) ?? null,
        updateMany: async (args: { where?: Row; data: Row }): Promise<{ count: number }> => {
          let count = 0;
          for (const o of this.opportunities.values()) {
            if (matchWhere(o, args.where)) {
              Object.assign(o, args.data);
              count += 1;
            }
          }
          return { count };
        },
      },
      contact: {
        findFirst: async (args: { where?: Row }): Promise<Row | null> =>
          values(this.contacts).find((r) => matchWhere(r, args.where)) ?? null,
      },
      receiptedBooking: {
        findFirst: async (args: { where?: Row }): Promise<Row | null> => {
          for (const r of this.receiptedBookings.values()) {
            if (matchWhere(r, args.where)) return r;
          }
          return null;
        },
        create: async (args: { data: Row }): Promise<Row> => {
          const data = args.data;
          this.receiptedBookings.set(data["bookingId"] as string, { ...data });
          return data;
        },
      },
      conversionRecord: { findFirst: async (): Promise<Row | null> => null },
      lifecycleRevenueEvent: { findMany: async (): Promise<Row[]> => [] },
      workTrace: { findFirst: async (): Promise<Row | null> => null },
      outboxEvent: {
        create: async (args: { data: Row }): Promise<Row> => {
          this.outbox.push(args.data);
          return args.data;
        },
      },
    };
  }

  /** Build the REAL calendar-book tool over this substrate with a stub Google Calendar provider. */
  buildBookingTool(ctx: SkillRequestContextLike, opts: { calendarEventId?: string } = {}) {
    const calendarEventId = opts.calendarEventId ?? "gcal-evt-1";
    const provider = {
      createBooking: async (): Promise<{ calendarEventId: string }> => ({ calendarEventId }),
      listAvailableSlots: async (): Promise<unknown[]> => [],
      cancelBooking: async (): Promise<void> => {},
    };
    const factory = createCalendarBookToolFactory({
      calendarProviderFactory: async () => provider,
      isCalendarProviderConfigured: () => true,
      bookingStore: this.bookingStoreAdapter(),
      opportunityStore: this.opportunityStoreAdapter(),
      contactStore: this.contactStoreAdapter(),
      runTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(this.client),
      failureHandler: {
        handle: async () => {
          throw new Error("failureHandler must not run on the booking happy path");
        },
      },
      defaultCurrency: "SGD",
      receiptTierForProvider: () => "T1_FETCH_BACK",
      isProduction: false,
    } as never);
    return factory(ctx as never);
  }
}

/** Convenience wrapper mirroring the test's call site. */
export function buildCalendarBookTool(
  db: InMemoryRevenueDb,
  ctx: SkillRequestContextLike,
  opts: { calendarEventId?: string } = {},
) {
  return db.buildBookingTool(ctx, opts);
}
