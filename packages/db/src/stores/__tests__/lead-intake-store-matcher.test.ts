import { describe, it, expect, vi } from "vitest";
import { PrismaLeadIntakeStore } from "../lead-intake-store.js";

// Mocked Prisma (CI has no Postgres) — mirrors prisma-contact-store.test.ts. Covers the A4 identity
// matcher's candidate lookup (findByPhoneOrEmail) query shape and the new upsert create fields.

describe("PrismaLeadIntakeStore.findByPhoneOrEmail (A4)", () => {
  it("builds an org-scoped OR over phoneE164 + email, take 2, minimal select", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: "x", name: "Jane", phoneE164: "+6591234567", email: "jane@x.com" },
      ]);
    const store = new PrismaLeadIntakeStore({ contact: { findMany } } as never);
    const rows = await store.findByPhoneOrEmail({
      organizationId: "org1",
      phoneE164: "+6591234567",
      email: "jane@x.com",
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org1",
        OR: [{ phoneE164: "+6591234567" }, { email: "jane@x.com" }],
      },
      select: { id: true, name: true, phoneE164: true, email: true },
      take: 2,
    });
    expect(rows).toEqual([
      { id: "x", name: "Jane", phoneE164: "+6591234567", email: "jane@x.com" },
    ]);
  });

  it("skips a null branch — email-only lookup has a single-clause OR", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const store = new PrismaLeadIntakeStore({ contact: { findMany } } as never);
    await store.findByPhoneOrEmail({
      organizationId: "org1",
      phoneE164: null,
      email: "jane@x.com",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org1", OR: [{ email: "jane@x.com" }] },
      }),
    );
  });

  it("returns [] without querying when both identifiers are null", async () => {
    const findMany = vi.fn();
    const store = new PrismaLeadIntakeStore({ contact: { findMany } } as never);
    expect(
      await store.findByPhoneOrEmail({ organizationId: "org1", phoneE164: null, email: null }),
    ).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("coalesces nullish row fields to null", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: "x", name: null, phoneE164: null, email: undefined }]);
    const store = new PrismaLeadIntakeStore({ contact: { findMany } } as never);
    const rows = await store.findByPhoneOrEmail({
      organizationId: "org1",
      phoneE164: "+6591234567",
      email: null,
    });
    expect(rows).toEqual([{ id: "x", name: null, phoneE164: null, email: null }]);
  });
});

describe("PrismaLeadIntakeStore.upsertContact (A4 fields)", () => {
  it("persists name + duplicateContactRisk on create", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "new" });
    const store = new PrismaLeadIntakeStore({ contact: { upsert } } as never);
    await store.upsertContact({
      organizationId: "org1",
      deploymentId: "d1",
      phone: "+6591234567",
      email: "jane@x.com",
      name: "Jane Tan",
      sourceType: "ctwa",
      attribution: {},
      idempotencyKey: "k1",
      duplicateContactRisk: true,
    });
    const arg = upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(arg.create.name).toBe("Jane Tan");
    expect(arg.create.duplicateContactRisk).toBe(true);
  });

  it("defaults duplicateContactRisk to false and name to null when omitted", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "new" });
    const store = new PrismaLeadIntakeStore({ contact: { upsert } } as never);
    await store.upsertContact({
      organizationId: "org1",
      deploymentId: "d1",
      phone: "+6591234567",
      sourceType: "ctwa",
      attribution: {},
      idempotencyKey: "k2",
    });
    const arg = upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(arg.create.duplicateContactRisk).toBe(false);
    expect(arg.create.name).toBeNull();
  });
});
