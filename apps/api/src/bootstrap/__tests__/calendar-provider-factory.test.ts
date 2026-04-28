import { describe, it, expect, vi } from "vitest";
import { createCalendarProviderFactory } from "../calendar-provider-factory.js";
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
