import { describe, it, expect, vi } from "vitest";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
import { buildLocalStore, createCalendarProviderFactory } from "../calendar-provider-factory.js";
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

describe("createCalendarProviderFactory: provisioning default resolves Local (F-01)", () => {
  it("resolves a non-Noop provider for a fresh org seeded with DEFAULT_BUSINESS_HOURS", async () => {
    // Pins the provisioning seam: the value seeded at org provisioning must be the kind of
    // object the factory accepts to leave the Noop tier. No Google env, so the only way out
    // of Noop is the seeded business hours. Driven from the REAL provisioning constant.
    const prisma = makePrisma({ "org-fresh": { businessHours: DEFAULT_BUSINESS_HOURS } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const provider = await factory("org-fresh");

    expect(isNoopCalendarProvider(provider)).toBe(false);
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

describe("buildLocalStore.findById: org-scoping (read-side IDOR fix)", () => {
  function makeBookingPrisma(row: Record<string, unknown> | null) {
    return { booking: { findFirst: vi.fn(async () => row) } };
  }

  it("reads through findFirst scoped to the closed-over org id", async () => {
    const prisma = makeBookingPrisma({
      id: "bk_1",
      contactId: "ct_1",
      organizationId: "org-A",
      service: "consultation",
      status: "confirmed",
      startsAt: new Date("2026-04-20T10:00:00Z"),
      endsAt: new Date("2026-04-20T10:30:00Z"),
      createdAt: new Date("2026-04-19T00:00:00Z"),
      updatedAt: new Date("2026-04-19T00:00:00Z"),
    });
    const store = buildLocalStore(prisma as never, "org-A");

    const result = await store.findById("bk_1");

    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { id: "bk_1", organizationId: "org-A" },
    });
    expect(result?.id).toBe("bk_1");
  });

  it("returns null for an id that belongs to another org (findFirst no-match)", async () => {
    const prisma = makeBookingPrisma(null);
    const store = buildLocalStore(prisma as never, "org-A");

    const result = await store.findById("bk-from-org-B");

    expect(result).toBeNull();
    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { id: "bk-from-org-B", organizationId: "org-A" },
    });
  });
});
