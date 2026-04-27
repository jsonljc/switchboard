import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../index.js";
import { PrismaLeadIntakeStore } from "../lead-intake-store.js";

// Integration test against a real Postgres. Requires DATABASE_URL to be set
// and `prisma migrate deploy` to have run (CI: see .github/workflows/ci.yml).
// Local: pnpm --filter @switchboard/db exec prisma migrate deploy.

const TEST_KEY_PREFIX = "test:lead-intake:";
const ORG_ID = "test-org:lead-intake-store";
const DEPLOYMENT_ID = "test-dep:lead-intake-store";

describe.skipIf(!process.env["DATABASE_URL"])("PrismaLeadIntakeStore (integration)", () => {
  const prisma = createPrismaClient();
  const store = new PrismaLeadIntakeStore(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    // Clean Contacts created during the test (filter on idempotencyKey marker).
    await prisma.contact.deleteMany({
      where: {
        organizationId: ORG_ID,
        idempotencyKey: { startsWith: TEST_KEY_PREFIX },
      },
    });
    // Clean ActivityLog rows created during the test.
    await prisma.activityLog.deleteMany({
      where: { organizationId: ORG_ID, deploymentId: DEPLOYMENT_ID },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("upsertContact writes a Contact with sourceType + attribution JSON", async () => {
    const key = `${TEST_KEY_PREFIX}upsert-${Date.now()}`;
    const result = await store.upsertContact({
      organizationId: ORG_ID,
      deploymentId: DEPLOYMENT_ID,
      phone: "+15550000001",
      email: "lead1@example.com",
      channel: "whatsapp",
      sourceType: "ctwa",
      sourceAdId: "ad_1",
      sourceCampaignId: "cmp_1",
      sourceAdsetId: "as_1",
      attribution: { ctwa_clid: "abc", source_url: "https://wa.me/x" },
      idempotencyKey: key,
    });

    expect(result.id).toBeTruthy();

    const row = await prisma.contact.findUnique({ where: { id: result.id } });
    expect(row).not.toBeNull();
    expect(row?.organizationId).toBe(ORG_ID);
    expect(row?.sourceType).toBe("ctwa");
    expect(row?.idempotencyKey).toBe(key);
    expect(row?.phone).toBe("+15550000001");
    expect(row?.email).toBe("lead1@example.com");
    expect(row?.primaryChannel).toBe("whatsapp");
    expect(row?.attribution).toMatchObject({ ctwa_clid: "abc", source_url: "https://wa.me/x" });
  });

  it("findContactByIdempotency returns the existing Contact for a previously-used key", async () => {
    const key = `${TEST_KEY_PREFIX}find-${Date.now()}`;
    const created = await store.upsertContact({
      organizationId: ORG_ID,
      deploymentId: DEPLOYMENT_ID,
      phone: "+15550000002",
      sourceType: "instant_form",
      attribution: { leadgen_id: "lg_1" },
      idempotencyKey: key,
    });

    const found = await store.findContactByIdempotency(key);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);

    const missing = await store.findContactByIdempotency(`${TEST_KEY_PREFIX}does-not-exist`);
    expect(missing).toBeNull();
  });

  it("upsertContact is idempotent on (organizationId, idempotencyKey)", async () => {
    const key = `${TEST_KEY_PREFIX}idem-${Date.now()}`;
    const a = await store.upsertContact({
      organizationId: ORG_ID,
      deploymentId: DEPLOYMENT_ID,
      phone: "+15550000003",
      sourceType: "ctwa",
      attribution: { v: 1 },
      idempotencyKey: key,
    });
    const b = await store.upsertContact({
      organizationId: ORG_ID,
      deploymentId: DEPLOYMENT_ID,
      phone: "+15550000003",
      sourceType: "ctwa",
      attribution: { v: 2 },
      idempotencyKey: key,
    });
    expect(b.id).toBe(a.id);

    const count = await prisma.contact.count({
      where: { organizationId: ORG_ID, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it("upsertContact deduplicates under concurrent calls with the same key", async () => {
    const key = `${TEST_KEY_PREFIX}race-${Date.now()}`;
    const input = {
      organizationId: ORG_ID,
      deploymentId: DEPLOYMENT_ID,
      phone: "+15550000004",
      sourceType: "ctwa",
      attribution: { ctwa_clid: "race" },
      idempotencyKey: key,
    };
    const results = await Promise.all([
      store.upsertContact(input),
      store.upsertContact(input),
      store.upsertContact(input),
    ]);
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);

    const count = await prisma.contact.count({
      where: { organizationId: ORG_ID, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it("createActivity writes a lead-lifecycle activity record queryable per-Contact", async () => {
    const key = `${TEST_KEY_PREFIX}activity-${Date.now()}`;
    const contact = await store.upsertContact({
      organizationId: ORG_ID,
      deploymentId: DEPLOYMENT_ID,
      phone: "+15550000005",
      sourceType: "ctwa",
      attribution: { ctwa_clid: "xyz" },
      idempotencyKey: key,
    });

    const activity = await store.createActivity({
      contactId: contact.id,
      organizationId: ORG_ID,
      deploymentId: DEPLOYMENT_ID,
      kind: "lead_received",
      sourceType: "ctwa",
      metadata: { attribution: { ctwa_clid: "xyz" } },
    });
    expect(activity.id).toBeTruthy();

    const row = await prisma.activityLog.findUnique({ where: { id: activity.id } });
    expect(row).not.toBeNull();
    expect(row?.eventType).toBe("lead_received");
    expect(row?.organizationId).toBe(ORG_ID);
    expect(row?.deploymentId).toBe(DEPLOYMENT_ID);
    const metadata = row?.metadata as Record<string, unknown>;
    expect(metadata.contactId).toBe(contact.id);
    expect(metadata.sourceType).toBe("ctwa");
    expect(metadata.attribution).toMatchObject({ ctwa_clid: "xyz" });
  });
});
