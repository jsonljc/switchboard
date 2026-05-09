import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaContactStore } from "../prisma-contact-store.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    contact: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    opportunity: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    organizationId: "org-1",
    name: "John Doe",
    phone: "+6591234567",
    email: "john@example.com",
    primaryChannel: "whatsapp",
    firstTouchChannel: "facebook",
    stage: "new",
    source: "facebook_ad",
    attribution: { fbclid: "abc123" },
    roles: ["lead"],
    messagingOptIn: false,
    messagingOptInAt: null,
    messagingOptInSource: null,
    messagingOptOutAt: null,
    firstContactAt: now,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("PrismaContactStore.listForBrowse", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaContactStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaContactStore(prisma as never);
  });

  const baseQuery = {
    orgId: "org-A",
    sort: "lastActivityAt" as const,
    direction: "desc" as const,
    limit: 50,
  };

  it("scopes every query to organizationId", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await store.listForBrowse(baseQuery);
    const call = prisma.contact.findMany.mock.calls[0]![0]!;
    expect(call.where.organizationId).toBe("org-A");
  });

  it("applies stage filter when provided", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await store.listForBrowse({ ...baseQuery, stage: "active" });
    const call = prisma.contact.findMany.mock.calls[0]![0]!;
    expect(call.where.stage).toBe("active");
  });

  it("applies search OR-clause across name/phone/email (case-insensitive)", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await store.listForBrowse({ ...baseQuery, search: "Lisa" });
    const call = prisma.contact.findMany.mock.calls[0]![0]!;
    const ands = call.where.AND as Array<{ OR: Array<Record<string, unknown>> }>;
    expect(ands).toHaveLength(1);
    const orClauses = ands[0]!.OR;
    expect(orClauses).toHaveLength(3);
    expect(orClauses[0]).toEqual({ name: { contains: "Lisa", mode: "insensitive" } });
    expect(orClauses[1]).toEqual({ phone: { contains: "Lisa", mode: "insensitive" } });
    expect(orClauses[2]).toEqual({ email: { contains: "Lisa", mode: "insensitive" } });
  });

  it("uses (lastActivityAt, id) keyset for cursor when present (desc => lt)", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    const cursorTs = new Date("2026-05-01T00:00:00Z");
    await store.listForBrowse({
      ...baseQuery,
      cursor: { ts: cursorTs, id: "c-7" },
    });
    const call = prisma.contact.findMany.mock.calls[0]![0]!;
    const ands = call.where.AND as Array<Record<string, unknown>>;
    const cursorClause = ands.find((a) => "OR" in a)!.OR as Array<Record<string, unknown>>;
    expect(cursorClause).toHaveLength(2);
    expect(cursorClause[0]).toEqual({ lastActivityAt: { lt: cursorTs } });
    expect(cursorClause[1]).toEqual({
      AND: [{ lastActivityAt: cursorTs }, { id: { lt: "c-7" } }],
    });
  });

  it("uses gt for asc direction", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await store.listForBrowse({
      ...baseQuery,
      direction: "asc",
      cursor: { ts: new Date("2026-05-01T00:00:00Z"), id: "c-7" },
    });
    const call = prisma.contact.findMany.mock.calls[0]![0]!;
    const ands = call.where.AND as Array<Record<string, unknown>>;
    const cursorClause = ands.find((a) => "OR" in a)!.OR as Array<Record<string, unknown>>;
    expect(cursorClause[0]).toEqual({
      lastActivityAt: { gt: new Date("2026-05-01T00:00:00Z") },
    });
  });

  it("combines search and cursor as separate AND-conditions, not concatenated ORs", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await store.listForBrowse({
      ...baseQuery,
      search: "Lisa",
      cursor: { ts: new Date("2026-05-01T00:00:00Z"), id: "c-7" },
    });
    const call = prisma.contact.findMany.mock.calls[0]![0]!;
    const ands = call.where.AND as Array<Record<string, unknown>>;
    // Two AND children: one search OR, one cursor OR. Both must hold.
    expect(ands).toHaveLength(2);
    // First is the search clause (3-way OR over name/phone/email).
    expect((ands[0]!.OR as unknown[]).length).toBe(3);
    // Second is the cursor clause (2-way OR — strict-less + tiebreak).
    expect((ands[1]!.OR as unknown[]).length).toBe(2);
  });

  it("orders by (sortField, id) with composite tiebreak", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await store.listForBrowse(baseQuery);
    const call = prisma.contact.findMany.mock.calls[0]![0]!;
    expect(call.orderBy).toEqual([{ lastActivityAt: "desc" }, { id: "desc" }]);
  });

  it("respects firstContactAt as alternate sort", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await store.listForBrowse({ ...baseQuery, sort: "firstContactAt" });
    const call = prisma.contact.findMany.mock.calls[0]![0]!;
    expect(call.orderBy).toEqual([{ firstContactAt: "desc" }, { id: "desc" }]);
  });

  it("fetches limit+1 rows; trims to limit and reports hasMore=true", async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      makeContact({ id: `c-${i}`, lastActivityAt: new Date(2026, 0, 51 - i) }),
    );
    prisma.contact.findMany.mockResolvedValue(rows);
    const result = await store.listForBrowse({ ...baseQuery, limit: 50 });
    expect(prisma.contact.findMany.mock.calls[0]![0]!.take).toBe(51);
    expect(result.rows).toHaveLength(50);
    expect(result.hasMore).toBe(true);
  });

  it("hasMore=false and nextKeyset=null on the final page", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => makeContact({ id: `c-${i}` }));
    prisma.contact.findMany.mockResolvedValue(rows);
    const result = await store.listForBrowse({ ...baseQuery, limit: 50 });
    expect(result.hasMore).toBe(false);
    expect(result.nextKeyset).toBeNull();
  });

  it("nextKeyset reflects last returned row's (sortField, id) when hasMore", async () => {
    const cutoffTs = new Date("2026-04-01T00:00:00Z");
    const rows = [
      makeContact({ id: "c-0", lastActivityAt: new Date("2026-05-01") }),
      makeContact({ id: "c-1", lastActivityAt: cutoffTs }), // last in trimmed window
      makeContact({ id: "c-2", lastActivityAt: new Date("2026-03-01") }), // gets trimmed (limit+1)
    ];
    prisma.contact.findMany.mockResolvedValue(rows);
    const result = await store.listForBrowse({ ...baseQuery, limit: 2 });
    expect(result.hasMore).toBe(true);
    expect(result.nextKeyset).toEqual({ ts: cutoffTs, id: "c-1" });
  });

  it("returns empty result when zero rows match", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    const result = await store.listForBrowse(baseQuery);
    expect(result.rows).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextKeyset).toBeNull();
    expect(result.opportunityCounts.size).toBe(0);
  });

  it("fetches opportunity counts via groupBy, capped at 99", async () => {
    const rows = [makeContact({ id: "c-1" }), makeContact({ id: "c-2" })];
    prisma.contact.findMany.mockResolvedValue(rows);
    prisma.opportunity.groupBy.mockResolvedValue([
      { contactId: "c-1", _count: { _all: 3 } },
      { contactId: "c-2", _count: { _all: 250 } }, // exceeds cap
    ]);
    const result = await store.listForBrowse(baseQuery);
    expect(prisma.opportunity.groupBy).toHaveBeenCalledWith({
      by: ["contactId"],
      where: {
        contactId: { in: ["c-1", "c-2"] },
        stage: { notIn: ["won", "lost"] },
      },
      _count: { _all: true },
    });
    expect(result.opportunityCounts.get("c-1")).toBe(3);
    expect(result.opportunityCounts.get("c-2")).toBe(99);
  });

  it("skips opportunity groupBy when no rows", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    const result = await store.listForBrowse(baseQuery);
    expect(prisma.opportunity.groupBy).not.toHaveBeenCalled();
    expect(result.opportunityCounts.size).toBe(0);
  });
});
