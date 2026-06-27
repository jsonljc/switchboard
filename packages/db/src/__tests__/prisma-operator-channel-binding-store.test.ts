import { describe, it, expect, vi } from "vitest";
import { PrismaOperatorChannelBindingStore } from "../stores/prisma-operator-channel-binding-store.js";

// ---------------------------------------------------------------------------
// EV-9b / GOV-3 — cross-tenant operator-channel-binding isolation.
//
// The OperatorChannelBinding lookup is the WhatsApp/chat approval authority
// gate: a stable channel identity (e.g. a phone number) is authorized to act as
// an internal Principal ONLY through an `active` binding for THAT org. The core
// interface (operator-channel-binding-store.ts) is a logicless contract; the
// real isolation enforcement lives HERE, in the Prisma store's WHERE clause +
// status filter. There is no test for it today.
//
// Two invariants (both fail-closed):
//   1. An org-B query NEVER resolves an org-A binding. Postgres enforces the
//      compound unique key; the store's job is to pass the QUERYING org into
//      that key. A store that dropped/hardcoded the org would let one tenant
//      ride another tenant's binding — a cross-tenant send-authority leak.
//   2. A `revoked` row is NEVER returned. Revocation must take effect on the
//      next lookup (no cached authority), so a non-`active` row resolves null.
// ---------------------------------------------------------------------------

const CHANNEL = "whatsapp";
const IDENTIFIER = "+15551234567";

/** A full active OperatorChannelBinding row as Prisma would return it. */
function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "binding-a",
    organizationId: "org-A",
    channel: CHANNEL,
    channelIdentifier: IDENTIFIER,
    principalId: "principal-a",
    status: "active",
    createdBy: "admin-a",
    revokedBy: null,
    revokedAt: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  };
}

/**
 * A Prisma double whose `findUnique` honors the compound-unique key the way
 * Postgres does: a row is returned ONLY when the queried (org, channel,
 * identifier) triple matches it exactly. This models real cross-tenant
 * isolation rather than a stub that returns a fixed row regardless of WHERE.
 */
function keyedPrisma(rows: Array<ReturnType<typeof activeRow>>) {
  const findUnique = vi.fn(
    async (args: {
      where: {
        organizationId_channel_channelIdentifier: {
          organizationId: string;
          channel: string;
          channelIdentifier: string;
        };
      };
    }) => {
      const key = args.where.organizationId_channel_channelIdentifier;
      return (
        rows.find(
          (r) =>
            r.organizationId === key.organizationId &&
            r.channel === key.channel &&
            r.channelIdentifier === key.channelIdentifier,
        ) ?? null
      );
    },
  );
  return { prisma: { operatorChannelBinding: { findUnique } }, findUnique };
}

describe("PrismaOperatorChannelBindingStore.findActiveBinding — GOV-3 cross-tenant isolation", () => {
  it("scopes the lookup to the QUERYING org (the compound WHERE carries the caller's org)", async () => {
    const { prisma, findUnique } = keyedPrisma([activeRow()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaOperatorChannelBindingStore(prisma as any);

    await store.findActiveBinding({
      organizationId: "org-B",
      channel: CHANNEL,
      channelIdentifier: IDENTIFIER,
    });

    // The org the caller supplied MUST be the org in the WHERE key. A store that
    // hardcoded or dropped the org would let org-B's query target a different
    // tenant's row — the cross-tenant authority hole this asserts against.
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_channel_channelIdentifier: {
          organizationId: "org-B",
          channel: CHANNEL,
          channelIdentifier: IDENTIFIER,
        },
      },
    });
  });

  it("an org-B query NEVER resolves an org-A binding (same channel + identifier)", async () => {
    // org-A owns an active binding for this exact phone number. org-B asks for
    // the SAME phone number under its own org context.
    const { prisma } = keyedPrisma([activeRow()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaOperatorChannelBindingStore(prisma as any);

    const orgA = await store.findActiveBinding({
      organizationId: "org-A",
      channel: CHANNEL,
      channelIdentifier: IDENTIFIER,
    });
    const orgB = await store.findActiveBinding({
      organizationId: "org-B",
      channel: CHANNEL,
      channelIdentifier: IDENTIFIER,
    });

    expect(orgA?.organizationId).toBe("org-A"); // control: org-A DOES see its own binding
    expect(orgB).toBeNull(); // isolation: org-B sees nothing
  });

  it("NEVER returns a revoked binding (revocation takes effect on the next lookup)", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue(activeRow({ status: "revoked", revokedBy: "admin-a" }));
    const prisma = { operatorChannelBinding: { findUnique } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaOperatorChannelBindingStore(prisma as any);

    const result = await store.findActiveBinding({
      organizationId: "org-A",
      channel: CHANNEL,
      channelIdentifier: IDENTIFIER,
    });

    expect(result).toBeNull();
  });

  it("returns null when no row exists", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { operatorChannelBinding: { findUnique } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaOperatorChannelBindingStore(prisma as any);

    const result = await store.findActiveBinding({
      organizationId: "org-A",
      channel: CHANNEL,
      channelIdentifier: IDENTIFIER,
    });

    expect(result).toBeNull();
  });

  it("returns the mapped record (status active) when an active row matches the org", async () => {
    const findUnique = vi.fn().mockResolvedValue(activeRow());
    const prisma = { operatorChannelBinding: { findUnique } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaOperatorChannelBindingStore(prisma as any);

    const result = await store.findActiveBinding({
      organizationId: "org-A",
      channel: CHANNEL,
      channelIdentifier: IDENTIFIER,
    });

    expect(result).toMatchObject({
      id: "binding-a",
      organizationId: "org-A",
      principalId: "principal-a",
      status: "active",
    });
  });
});
