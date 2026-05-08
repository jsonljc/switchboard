import { describe, it, expect, vi } from "vitest";
import { getOrgTimezone, ORG_TIMEZONE_FALLBACK } from "../org-timezone.js";
import type { PrismaClient } from "@switchboard/db";

const FALLBACK = ORG_TIMEZONE_FALLBACK; // "Asia/Singapore"

function makePrisma(businessHours: unknown): PrismaClient {
  return {
    organizationConfig: {
      findFirst: vi.fn().mockResolvedValue(businessHours === undefined ? null : { businessHours }),
    },
  } as unknown as PrismaClient;
}

describe("getOrgTimezone", () => {
  it("returns configured timezone when businessHours is present and valid", async () => {
    const bh = {
      timezone: "America/New_York",
      days: [{ day: 1, open: "09:00", close: "17:00" }],
      defaultDurationMinutes: 60,
      bufferMinutes: 15,
    };
    const prisma = makePrisma(bh);
    const result = await getOrgTimezone(prisma, "org-1");
    expect(result).toBe("America/New_York");
  });

  it("returns fallback when prisma is null", async () => {
    const result = await getOrgTimezone(null, "org-1");
    expect(result).toBe(FALLBACK);
  });

  it("returns fallback when businessHours is null", async () => {
    const prisma = makePrisma(null);
    const result = await getOrgTimezone(prisma, "org-1");
    expect(result).toBe(FALLBACK);
  });

  it("returns fallback when organizationConfig row is not found", async () => {
    // undefined signals row not found
    const prisma = makePrisma(undefined);
    const result = await getOrgTimezone(prisma, "org-missing");
    expect(result).toBe(FALLBACK);
  });

  it("returns fallback when businessHours is malformed (invalid schema)", async () => {
    const malformed = { timezone: 999, days: "not-an-array" };
    const prisma = makePrisma(malformed);
    const result = await getOrgTimezone(prisma, "org-1");
    expect(result).toBe(FALLBACK);
  });

  it("returns fallback when businessHours is an array", async () => {
    const prisma = makePrisma([{ timezone: "America/New_York" }]);
    const result = await getOrgTimezone(prisma, "org-1");
    expect(result).toBe(FALLBACK);
  });

  it("returns fallback when businessHours is valid but timezone field is missing", async () => {
    // BusinessHoursConfigSchema requires timezone — missing it fails safeParse
    const bhNoTz = {
      days: [{ day: 1, open: "09:00", close: "17:00" }],
      defaultDurationMinutes: 60,
      bufferMinutes: 15,
    };
    const prisma = makePrisma(bhNoTz);
    const result = await getOrgTimezone(prisma, "org-1");
    expect(result).toBe(FALLBACK);
  });

  it("returns fallback when businessHours is a string primitive", async () => {
    const prisma = makePrisma("Asia/Tokyo");
    const result = await getOrgTimezone(prisma, "org-1");
    expect(result).toBe(FALLBACK);
  });
});
