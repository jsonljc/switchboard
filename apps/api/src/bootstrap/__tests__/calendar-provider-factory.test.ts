import { describe, it, expect, vi } from "vitest";
import { createCalendarProviderFactory } from "../calendar-provider-factory.js";

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
