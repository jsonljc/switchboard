import { describe, it, expect, vi } from "vitest";
import { createCalendarProviderFactory, buildLocalStore } from "../calendar-provider-factory.js";
import { isNoopCalendarProvider, NoopCalendarProvider } from "../noop-calendar-provider.js";

function makePrisma(rowByOrg: Record<string, { businessHours: unknown } | null>) {
  return {
    organizationConfig: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        return rowByOrg[where.id] ?? null;
      }),
    },
  };
}

const silentLogger = { info: () => {}, error: () => {} };

describe("createCalendarProviderFactory: input validation", () => {
  it("rejects with ORG_ID_REQUIRED when orgId is empty string", async () => {
    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({}) as never,
      logger: silentLogger,
      env: {},
    });

    await expect(factory("")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });

  it("rejects with ORG_ID_REQUIRED when orgId is whitespace-only", async () => {
    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({}) as never,
      logger: silentLogger,
      env: {},
    });

    await expect(factory("   ")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });
});

describe("createCalendarProviderFactory: Noop fallback", () => {
  it("returns NoopCalendarProvider when org has no businessHours and no Google env", async () => {
    const prisma = makePrisma({ "org-A": { businessHours: null } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const provider = await factory("org-A");

    expect(isNoopCalendarProvider(provider)).toBe(true);
  });

  it("returns NoopCalendarProvider when OrganizationConfig row is missing", async () => {
    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({}) as never,
      logger: silentLogger,
      env: {},
    });

    expect(isNoopCalendarProvider(await factory("org-missing"))).toBe(true);
  });

  it("treats array businessHours as not configured (Noop)", async () => {
    const prisma = makePrisma({ "org-A": { businessHours: [] } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    expect(isNoopCalendarProvider(await factory("org-A"))).toBe(true);
  });
});

describe("createCalendarProviderFactory: Local provider", () => {
  it("returns a non-Noop provider when businessHours object is present", async () => {
    const prisma = makePrisma({
      "org-local": {
        businessHours: { mon: [{ start: "09:00", end: "17:00" }] },
      },
    });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const provider = await factory("org-local");

    expect(isNoopCalendarProvider(provider)).toBe(false);
    expect(provider).not.toBeInstanceOf(NoopCalendarProvider);
  });
});

describe("createCalendarProviderFactory: memoization", () => {
  it("returns the same Promise for the same orgId across calls", async () => {
    const prisma = makePrisma({ "org-A": { businessHours: null } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const p1 = factory("org-A");
    const p2 = factory("org-A");

    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
    expect(prisma.organizationConfig.findFirst).toHaveBeenCalledTimes(1);
  });

  it("returns independent providers for different orgIds", async () => {
    const prisma = makePrisma({
      "org-A": { businessHours: { mon: [{ start: "09:00", end: "17:00" }] } },
      "org-B": { businessHours: null },
    });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const [a, b] = await Promise.all([factory("org-A"), factory("org-B")]);

    expect(isNoopCalendarProvider(a)).toBe(false);
    expect(isNoopCalendarProvider(b)).toBe(true);
    expect(prisma.organizationConfig.findFirst).toHaveBeenCalledTimes(2);
  });

  it("concurrent first calls for the same org share construction", async () => {
    const prisma = makePrisma({ "org-A": { businessHours: null } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const [a, b] = await Promise.all([factory("org-A"), factory("org-A")]);

    expect(a).toBe(b);
    expect(prisma.organizationConfig.findFirst).toHaveBeenCalledTimes(1);
  });

  it("rejected construction is cleared from cache so a later call can retry", async () => {
    let attempt = 0;
    const prisma = {
      organizationConfig: {
        findFirst: vi.fn(async () => {
          attempt += 1;
          if (attempt === 1) throw new Error("DB connection lost");
          return { businessHours: null };
        }),
      },
    };
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    await expect(factory("org-A")).rejects.toThrow(/DB connection lost/);

    // Second call must NOT receive the rejected promise.
    const provider = await factory("org-A");
    expect(isNoopCalendarProvider(provider)).toBe(true);
    expect(prisma.organizationConfig.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("createCalendarProviderFactory: Local provider email wiring (#9a regression)", () => {
  it("wires emailSender on the Local provider when RESEND_API_KEY is set", async () => {
    const prisma = makePrisma({
      "org-local": { businessHours: { mon: [{ start: "09:00", end: "17:00" }] } },
    });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "noreply@example.com" },
    });

    const provider = (await factory("org-local")) as unknown as { emailSender?: unknown };

    expect(provider.emailSender).toBeTypeOf("function");
  });

  it("leaves emailSender undefined when RESEND_API_KEY is absent", async () => {
    const prisma = makePrisma({
      "org-local": { businessHours: { mon: [{ start: "09:00", end: "17:00" }] } },
    });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const provider = (await factory("org-local")) as unknown as { emailSender?: unknown };

    expect(provider.emailSender).toBeUndefined();
  });

  it("always wires onSendFailure for operator visibility", async () => {
    const prisma = makePrisma({
      "org-local": { businessHours: { mon: [{ start: "09:00", end: "17:00" }] } },
    });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const provider = (await factory("org-local")) as unknown as { onSendFailure?: unknown };

    expect(provider.onSendFailure).toBeTypeOf("function");
  });
});

describe("buildLocalStore.createInTransaction: advisory lock (F12)", () => {
  function makeTxPrisma() {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "bk_new" }),
      },
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { prisma, tx };
  }

  const STORE_ORG = "org-from-store";

  const baseInput = {
    organizationId: STORE_ORG,
    contactId: "ct-1",
    service: "consultation",
    startsAt: new Date("2026-06-20T02:00:00Z"),
    endsAt: new Date("2026-06-20T03:00:00Z"),
    timezone: "Asia/Singapore",
    status: "confirmed",
    calendarEventId: "local-evt-1",
    createdByType: "agent",
  };

  it("takes pg_advisory_xact_lock(BOOKING_LOCK_NS, hashtext(orgId)) before the overlap check and insert", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.createInTransaction(baseInput);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const lockSql = (strings as string[]).join("?");
    expect(lockSql).toContain("pg_advisory_xact_lock");
    // The ::int4 cast is the load-bearing fix: Prisma sends the namespace as bigint and
    // pg_advisory_xact_lock(bigint, integer) does not exist. Guard it in the always-on suite.
    expect(lockSql).toContain("::int4");
    expect(values).toContain(920_001);
    expect(values).toContain(STORE_ORG);

    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const createOrder = (tx.booking.create as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
    expect(findOrder).toBeLessThan(createOrder);
  });

  it("keys the lock, overlap check, and insert all off the store's bound org", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.createInTransaction(baseInput);

    const lockValues = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0]!.slice(1);
    expect(lockValues).toContain(STORE_ORG);
    const overlapWhere = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(overlapWhere.organizationId).toBe(STORE_ORG);
    const createData = (tx.booking.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(createData.organizationId).toBe(STORE_ORG);
  });

  it("rejects ORGANIZATION_MISMATCH without locking or inserting when the payload org differs", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(
      store.createInTransaction({ ...baseInput, organizationId: "org-from-input" }),
    ).rejects.toThrow("ORGANIZATION_MISMATCH");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("throws SLOT_CONFLICT without inserting when an overlap exists, lock still taken first", async () => {
    const { prisma, tx } = makeTxPrisma();
    (tx.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "existing" }]);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.createInTransaction(baseInput)).rejects.toThrow("SLOT_CONFLICT");
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
  });
});

describe("buildLocalStore.reschedule: advisory lock + org scope (F12 follow-up)", () => {
  function makeTxPrisma() {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { prisma, tx };
  }

  const STORE_ORG = "org-from-store";
  const BOOKING_ID = "bk-1";
  const newSlot = { start: "2026-06-20T04:00:00Z", end: "2026-06-20T05:00:00Z" };

  it("takes pg_advisory_xact_lock(::int4) before the overlap check and update", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.reschedule(BOOKING_ID, newSlot);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const lockSql = (strings as string[]).join("?");
    expect(lockSql).toContain("pg_advisory_xact_lock");
    expect(lockSql).toContain("::int4");
    expect(values).toContain(920_001);
    expect(values).toContain(STORE_ORG);

    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const updateOrder = (tx.booking.updateMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
    expect(findOrder).toBeLessThan(updateOrder);
  });

  it("scopes the overlap check to the bound org and excludes the booking being moved", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.reschedule(BOOKING_ID, newSlot);

    const overlapWhere = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(overlapWhere.organizationId).toBe(STORE_ORG);
    expect(overlapWhere.id).toEqual({ not: BOOKING_ID });
  });

  it("scopes the update to the bound org (IDOR guard), increments count, returns { id }", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    const result = await store.reschedule(BOOKING_ID, newSlot);

    const updateArgs = (tx.booking.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateArgs.where).toEqual({ id: BOOKING_ID, organizationId: STORE_ORG });
    expect(updateArgs.data.rescheduleCount).toEqual({ increment: 1 });
    expect(result).toEqual({ id: BOOKING_ID });
  });

  it("throws SLOT_CONFLICT without updating when an overlap exists, lock still taken first", async () => {
    const { prisma, tx } = makeTxPrisma();
    (tx.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "other" }]);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.reschedule(BOOKING_ID, newSlot)).rejects.toThrow("SLOT_CONFLICT");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
  });

  it("throws BOOKING_NOT_FOUND when updateMany matches no row (missing or cross-org id)", async () => {
    const { prisma, tx } = makeTxPrisma();
    (tx.booking.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.reschedule(BOOKING_ID, newSlot)).rejects.toThrow("BOOKING_NOT_FOUND");
  });
});

describe("buildLocalStore.cancel: org scope (F12 follow-up)", () => {
  const STORE_ORG = "org-from-store";
  const BOOKING_ID = "bk-1";

  function makePrisma(count: number) {
    return { booking: { updateMany: vi.fn().mockResolvedValue({ count }) } };
  }

  it("scopes the cancel update to the bound org (IDOR guard)", async () => {
    const prisma = makePrisma(1);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.cancel(BOOKING_ID);

    const updateArgs = (prisma.booking.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateArgs.where).toEqual({ id: BOOKING_ID, organizationId: STORE_ORG });
    expect(updateArgs.data).toEqual({ status: "cancelled" });
  });

  it("throws BOOKING_NOT_FOUND when updateMany matches no row (missing or cross-org id)", async () => {
    const prisma = makePrisma(0);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.cancel(BOOKING_ID)).rejects.toThrow("BOOKING_NOT_FOUND");
  });

  it("resolves void on success", async () => {
    const prisma = makePrisma(1);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.cancel(BOOKING_ID)).resolves.toBeUndefined();
  });
});
