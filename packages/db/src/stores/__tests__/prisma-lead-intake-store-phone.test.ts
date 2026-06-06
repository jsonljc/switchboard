import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaLeadIntakeStore } from "../lead-intake-store.js";

function makeMockPrisma() {
  return {
    contact: {
      upsert: vi.fn().mockResolvedValue({ id: "contact-1" }),
    },
    activityLog: {
      create: vi.fn().mockResolvedValue({ id: "activity-1" }),
    },
  };
}

describe("PrismaLeadIntakeStore.upsertContact phoneE164", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaLeadIntakeStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaLeadIntakeStore(prisma as never);
  });

  it("derives phoneE164 into the create branch and leaves the update branch untouched", async () => {
    await store.upsertContact({
      organizationId: "org-1",
      deploymentId: "dep-1",
      phone: "+6591234567",
      sourceType: "ctwa",
      attribution: { ctwa_clid: "abc" },
      idempotencyKey: "+6591234567:abc",
    });

    const call = prisma.contact.upsert.mock.calls[0]![0] as {
      create: { phoneE164: string | null };
      update: Record<string, unknown>;
    };
    expect(call.create.phoneE164).toBe("+6591234567");
    expect(call.update).not.toHaveProperty("phoneE164");
  });

  it("derives +65 for a bare SG 8-digit phone", async () => {
    await store.upsertContact({
      organizationId: "org-1",
      deploymentId: "dep-1",
      phone: "91234567",
      sourceType: "ctwa",
      attribution: {},
      idempotencyKey: "k1",
    });
    const call = prisma.contact.upsert.mock.calls[0]![0] as {
      create: { phoneE164: string | null };
    };
    expect(call.create.phoneE164).toBe("+6591234567");
  });

  it("writes phoneE164: null when the phone cannot be normalized", async () => {
    await store.upsertContact({
      organizationId: "org-1",
      deploymentId: "dep-1",
      phone: undefined,
      sourceType: "instant_form",
      attribution: {},
      idempotencyKey: "k2",
    });
    const call = prisma.contact.upsert.mock.calls[0]![0] as {
      create: { phoneE164: string | null };
    };
    expect(call.create.phoneE164).toBeNull();
  });
});
