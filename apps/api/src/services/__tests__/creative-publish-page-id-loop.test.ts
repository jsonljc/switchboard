import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PrismaConnectionStore,
  encryptCredentials,
  decryptCredentials,
  type PrismaClient,
} from "@switchboard/db";
import { assertPublishable } from "../creative-publish-preconditions.js";

// This test uses the REAL credential crypto (it does NOT mock @switchboard/db) so it proves
// that what the setter WRITES is what the publish gate READS — a real encrypt -> decrypt
// round-trip, not a mocked-decrypt re-assertion of already-tested behavior.

const TEST_KEY = "test-credentials-encryption-key-0123456789";
const ORG = "org_loop";
const CONN_ID = "conn_loop";
const JOB_ID = "job_loop";

// Stateful in-memory Prisma double: one meta-ads connection row + a publishable creative job.
// findFirst / updateMany honor the WHERE filters used by BOTH the gate (serviceId+org) and the
// store (id+org), so the same in-memory row is shared across the setter and the gate.
function makeStatefulPrisma(initialCredentials: string) {
  const row = {
    id: CONN_ID,
    serviceId: "meta-ads",
    organizationId: ORG,
    credentials: initialCredentials,
    externalAccountId: null as string | null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-memory Prisma double for tests
  const matches = (w: any) =>
    (w.id === undefined || w.id === row.id) &&
    (w.organizationId === undefined || w.organizationId === row.organizationId) &&
    (w.serviceId === undefined || w.serviceId === row.serviceId);
  return {
    connection: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-memory Prisma double
      findFirst: vi.fn(async ({ where }: any) => (matches(where) ? { ...row } : null)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-memory Prisma double
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 };
        if (typeof data.credentials === "string") row.credentials = data.credentials;
        return { count: 1 };
      }),
    },
    creativeJob: {
      findUnique: vi.fn(async () => ({
        id: JOB_ID,
        organizationId: ORG,
        currentStage: "complete",
        stoppedAt: null,
        reviewDecision: "kept",
        durableAssetUrl: "https://assets.example/creative-assets/job_loop/assembled.mp4",
      })),
    },
  };
}

describe("page-id setter closes the publish gate (real crypto round-trip)", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env["CREDENTIALS_ENCRYPTION_KEY"];
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = TEST_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    else process.env["CREDENTIALS_ENCRYPTION_KEY"] = savedKey;
  });

  it("flips META_PAGE_NOT_CONFIGURED to ok once an operator sets a pageId, preserving the token", async () => {
    // Seed a real-encrypted meta-ads connection WITHOUT a pageId.
    const prisma = makeStatefulPrisma(
      encryptCredentials({ accessToken: "tok_live", accountId: "act_123" }),
    );
    const store = new PrismaConnectionStore(prisma as unknown as PrismaClient);
    const deps = {
      prisma: prisma as unknown as PrismaClient,
      decrypt: (e: unknown) => decryptCredentials(e as string),
    };

    // Before: the gate blocks on the missing pageId.
    const before = await assertPublishable(deps, ORG, JOB_ID);
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.code).toBe("META_PAGE_NOT_CONFIGURED");

    // Operator sets the page id (exactly what the route does).
    const result = await store.mergeCredentialsById(CONN_ID, ORG, "meta-ads", {
      pageId: "123456789012345",
    });
    expect(result).toBe("updated");

    // After: the gate resolves; accessToken/accountId survived the merge.
    const after = await assertPublishable(deps, ORG, JOB_ID);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.pageId).toBe("123456789012345");
      expect(after.accessToken).toBe("tok_live");
      expect(after.accountId).toBe("act_123");
    }
  });
});
