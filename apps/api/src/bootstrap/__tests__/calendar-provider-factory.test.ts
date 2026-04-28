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
