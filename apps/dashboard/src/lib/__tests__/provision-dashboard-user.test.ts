import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";

// provision-dashboard-user imports only seedOrgDayOneAgents from @switchboard/db. Stub it so the
// test exercises the provisioning function's own writes without pulling in the real db package.
vi.mock("@switchboard/db", () => ({
  seedOrgDayOneAgents: vi.fn(async () => {}),
}));

import { provisionDashboardUser } from "../provision-dashboard-user";

const TEST_SECRET = "test-encryption-secret-at-least-32-chars-long";

function makeTxPrisma() {
  const tx = {
    organizationConfig: { create: vi.fn(async () => ({})) },
    principal: { create: vi.fn(async () => ({})) },
    identitySpec: { create: vi.fn(async () => ({})) },
    dashboardUser: { create: vi.fn(async () => ({ id: "du_1" })) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx };
}

describe("provisionDashboardUser business hours seeding (F-01)", () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    // encryptApiKey (called inside the provisioning transaction) requires the key.
    savedEnv = process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_SECRET;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.CREDENTIALS_ENCRYPTION_KEY = savedEnv;
    } else {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    }
  });

  it("creates the org config with default business hours so a fresh org books out of the box", async () => {
    const { prisma, tx } = makeTxPrisma();

    await provisionDashboardUser(prisma as never, { email: "owner@clinic.test" });

    const createArg = (tx.organizationConfig.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.data.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
  });
});
