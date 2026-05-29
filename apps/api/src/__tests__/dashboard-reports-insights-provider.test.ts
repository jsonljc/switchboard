import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@switchboard/db";
import { resolveInsightsProvider } from "../routes/dashboard-reports.js";

describe("resolveInsightsProvider — connection lookup", () => {
  it("queries the Meta Ads connection by the canonical serviceId 'meta-ads'", async () => {
    // The credential resolver writes Connection rows with serviceId "meta-ads"
    // (platformKey "meta"). The reports route must look the connection up by the
    // same serviceId, or an org's real Meta connection is never found.
    const calls: Array<{ where?: { serviceId?: string } }> = [];
    const fakePrisma = {
      connection: {
        findFirst: async (args: { where?: { serviceId?: string } }) => {
          calls.push(args);
          return null;
        },
      },
    } as unknown as PrismaClient;

    await resolveInsightsProvider({ prisma: fakePrisma }, "org-1");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.where?.serviceId).toBe("meta-ads");
  });

  it("returns null when no prisma client is available", async () => {
    const provider = await resolveInsightsProvider({ prisma: null }, "org-1");
    expect(provider).toBeNull();
  });
});
