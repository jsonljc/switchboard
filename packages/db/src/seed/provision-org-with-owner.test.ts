import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
import { decryptApiKey } from "../crypto/api-key.js";

// seedOrgDayOneAgents runs post-transaction; provisionOrgAgentDeployments is the
// eager-Riley seeder provisionPilotOrg composes. Both are sibling db modules — stub
// them so the test exercises provision-org-with-owner's own writes without running the
// real seeders against the in-memory mock.
vi.mock("./seed-org-day-one-agents.js", () => ({
  seedOrgDayOneAgents: vi.fn(async () => {}),
}));
vi.mock("./provision-org-agents.js", () => ({
  provisionOrgAgentDeployments: vi.fn(async () => ({ riley: { deploymentId: "deploy_riley" } })),
}));

import { provisionOrgWithOwner, provisionPilotOrg } from "./provision-org-with-owner.js";
import { seedOrgDayOneAgents } from "./seed-org-day-one-agents.js";
import { provisionOrgAgentDeployments } from "./provision-org-agents.js";

const TEST_SECRET = "test-encryption-secret-at-least-32-chars-long";

interface CreateCall {
  data: Record<string, unknown>;
}

function makeTxPrisma() {
  const order: string[] = [];
  const tx = {
    organizationConfig: {
      create: vi.fn(async (args: CreateCall) => {
        order.push("organizationConfig");
        return args.data;
      }),
    },
    principal: {
      create: vi.fn(async (args: CreateCall) => {
        order.push("principal");
        return args.data;
      }),
    },
    identitySpec: {
      create: vi.fn(async (args: CreateCall) => {
        order.push("identitySpec");
        return args.data;
      }),
    },
    dashboardUser: {
      create: vi.fn(async (args: CreateCall) => {
        order.push("dashboardUser");
        // Spread first, then pin id last so the returned user has a deterministic id
        // (the impl mints its own randomUUID id in args.data, which we override here).
        return { ...args.data, id: "du_1", organizationId: args.data.organizationId };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx, order };
}

describe("provisionOrgWithOwner", () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    // encryptApiKey (called inside the provisioning transaction) needs the key.
    savedEnv = process.env["CREDENTIALS_ENCRYPTION_KEY"];
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = TEST_SECRET;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env["CREDENTIALS_ENCRYPTION_KEY"] = savedEnv;
    } else {
      delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the org config with comped entitlement and default business hours (F-01/F-02)", async () => {
    const { prisma, tx } = makeTxPrisma();
    await provisionOrgWithOwner(prisma as never, { email: "owner@clinic.test" });

    expect(tx.organizationConfig.create).toHaveBeenCalledTimes(1);
    const data = (tx.organizationConfig.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(data.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(data.entitlementOverride).toBe(true);
    expect(data.runtimeType).toBe("managed");
    expect(data.governanceProfile).toBe("guarded");
    expect(data.provisioningStatus).toBe("pending");
  });

  it("creates the owner principal with full admin roles", async () => {
    const { prisma, tx } = makeTxPrisma();
    await provisionOrgWithOwner(prisma as never, { email: "owner@clinic.test" });

    const data = (tx.principal.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(data.type).toBe("user");
    expect(data.roles).toEqual(["operator", "admin", "approver"]);
  });

  it("creates the owner IdentitySpec scoped to the new org + principal", async () => {
    const { prisma, tx } = makeTxPrisma();
    await provisionOrgWithOwner(prisma as never, { email: "owner@clinic.test" });

    expect(tx.identitySpec.create).toHaveBeenCalledTimes(1);
    const data = (tx.identitySpec.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    const principalData = (tx.principal.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    const orgData = (tx.organizationConfig.create as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .data;
    expect(data.principalId).toBe(principalData.id);
    expect(data.organizationId).toBe(orgData.id);
  });

  it("creates the DashboardUser with an apiKey that decrypts back to a real key", async () => {
    const { prisma, tx } = makeTxPrisma();
    await provisionOrgWithOwner(prisma as never, {
      email: "owner@clinic.test",
      emailVerified: new Date(),
      passwordHash: "$2a$12$hashplaceholder",
    });

    const data = (tx.dashboardUser.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(data.email).toBe("owner@clinic.test");
    expect(data.passwordHash).toBe("$2a$12$hashplaceholder");
    // The stored apiKey must round-trip through the canonical decryptor the request
    // path (get-api-client.ts) uses, or every provisioned owner is locked out.
    const decrypted = decryptApiKey(data.apiKeyEncrypted as string);
    expect(decrypted).toMatch(/^sk_/);
    expect(typeof data.apiKeyHash).toBe("string");
  });

  it("omits passwordHash entirely when not provided (no null clobber)", async () => {
    const { prisma, tx } = makeTxPrisma();
    await provisionOrgWithOwner(prisma as never, { email: "owner@clinic.test" });

    const data = (tx.dashboardUser.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect("passwordHash" in data).toBe(false);
  });

  it("seeds day-one agents AFTER the transaction commits", async () => {
    const { prisma } = makeTxPrisma();
    await provisionOrgWithOwner(prisma as never, { email: "owner@clinic.test" });

    expect(seedOrgDayOneAgents).toHaveBeenCalledTimes(1);
    // seeded with the real PrismaClient (not the tx client) + the new org id.
    const orgId = (seedOrgDayOneAgents as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(orgId).toMatch(/^org_/);
  });

  it("does NOT eagerly provision Riley (signup defers deployment to lazy GET /config)", async () => {
    const { prisma } = makeTxPrisma();
    await provisionOrgWithOwner(prisma as never, { email: "owner@clinic.test" });
    expect(provisionOrgAgentDeployments).not.toHaveBeenCalled();
  });
});

describe("provisionPilotOrg", () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    savedEnv = process.env["CREDENTIALS_ENCRYPTION_KEY"];
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = TEST_SECRET;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env["CREDENTIALS_ENCRYPTION_KEY"] = savedEnv;
    } else {
      delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provisions the owner AND eagerly ensures Riley (mira:false) for the new org", async () => {
    const { prisma } = makeTxPrisma();
    const user = await provisionPilotOrg(prisma as never, { email: "owner@clinic.test" });

    expect(provisionOrgAgentDeployments).toHaveBeenCalledTimes(1);
    const [, orgArg, optsArg] = (provisionOrgAgentDeployments as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(orgArg).toBe(user.organizationId);
    expect(optsArg).toEqual({ mira: false });
  });

  it("returns the created DashboardUser", async () => {
    const { prisma } = makeTxPrisma();
    const user = await provisionPilotOrg(prisma as never, { email: "owner@clinic.test" });
    expect(user.id).toBe("du_1");
    expect(user.email).toBe("owner@clinic.test");
  });
});
