import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Handoff } from "@switchboard/core";
import { PrismaHandoffStore } from "../handoff-store.js";

describe("PrismaHandoffStore", () => {
  const mockUpsert = vi.fn();
  const mockFindFirst = vi.fn();
  const mockFindMany = vi.fn();
  const mockUpdateMany = vi.fn();

  const mockPrisma = {
    handoff: {
      upsert: mockUpsert,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  let store: PrismaHandoffStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PrismaHandoffStore(mockPrisma);
  });

  function sampleRow(overrides: Record<string, unknown> = {}) {
    const now = new Date();
    return {
      id: "h1",
      sessionId: "s1",
      organizationId: "org_1",
      status: "pending",
      reason: "human_requested",
      leadSnapshot: { name: "Alice", channel: "whatsapp" },
      qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "mql" },
      conversationSummary: {
        turnCount: 5,
        keyTopics: [],
        objectionHistory: [],
        sentiment: "neutral",
      },
      slaDeadlineAt: now,
      acknowledgedAt: null,
      createdAt: now,
      ...overrides,
    };
  }

  describe("listPending()", () => {
    it("queries for pending/assigned/active handoffs ordered by slaDeadlineAt", async () => {
      const now = new Date();
      mockFindMany.mockResolvedValue([
        sampleRow({ id: "h1", status: "pending" }),
        sampleRow({ id: "h2", status: "active", slaDeadlineAt: new Date(now.getTime() + 60_000) }),
      ]);

      const result = await store.listPending("org_1");

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          status: { in: ["pending", "assigned", "active"] },
        },
        orderBy: { slaDeadlineAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("h1");
      expect(result[1]!.id).toBe("h2");
    });

    it("returns empty array when no pending handoffs exist", async () => {
      mockFindMany.mockResolvedValue([]);
      const result = await store.listPending("org_empty");
      expect(result).toEqual([]);
    });
  });

  describe("getById()", () => {
    it("scopes the query to organizationId and id, and maps the row", async () => {
      mockFindFirst.mockResolvedValue(sampleRow());
      const result = await store.getById("org_1", "h1");
      expect(mockFindFirst).toHaveBeenCalledWith({ where: { id: "h1", organizationId: "org_1" } });
      expect(result).not.toBeNull();
      expect(result!.id).toBe("h1");
      expect(result!.acknowledgedAt).toBeUndefined();
      expect(result!.leadSnapshot.name).toBe("Alice");
    });

    it("returns null when not found", async () => {
      mockFindFirst.mockResolvedValue(null);
      const result = await store.getById("org_1", "nonexistent");
      expect(result).toBeNull();
    });

    it("denies cross-tenant read: a wrong org yields null and the where-clause carries that org", async () => {
      mockFindFirst.mockResolvedValue(null);
      const result = await store.getById("org_OTHER", "h1");
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { id: "h1", organizationId: "org_OTHER" },
      });
      expect(result).toBeNull();
    });
  });

  describe("getBySessionId()", () => {
    it("scopes the query to organizationId and sessionId, newest first", async () => {
      mockFindFirst.mockResolvedValue(sampleRow());
      const result = await store.getBySessionId("org_1", "s1");
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { sessionId: "s1", organizationId: "org_1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result!.sessionId).toBe("s1");
    });

    it("denies cross-tenant read: a wrong org yields null and the where-clause carries that org", async () => {
      mockFindFirst.mockResolvedValue(null);
      const result = await store.getBySessionId("org_OTHER", "s1");
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { sessionId: "s1", organizationId: "org_OTHER" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("updateStatus()", () => {
    it("updates status with an org-scoped updateMany (no acknowledgedAt)", async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });
      await store.updateStatus("org_1", "h1", "released");
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: "h1", organizationId: "org_1" },
        data: { status: "released" },
      });
    });

    it("updates status with acknowledgedAt", async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });
      const ackDate = new Date("2026-03-18T12:00:00Z");
      await store.updateStatus("org_1", "h1", "assigned", ackDate);
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: "h1", organizationId: "org_1" },
        data: { status: "assigned", acknowledgedAt: ackDate },
      });
    });

    it("denies cross-tenant mutation: count===0 throws instead of silently succeeding", async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });
      await expect(store.updateStatus("org_OTHER", "h1", "released")).rejects.toThrow(
        "Handoff not found or does not belong to organization: h1",
      );
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: "h1", organizationId: "org_OTHER" },
        data: { status: "released" },
      });
    });
  });

  describe("tenant isolation (behavioral: the where-clause actually isolates)", () => {
    // An honest in-memory stand-in for Prisma.findFirst that APPLIES the
    // where-clause and orderBy the store builds, so these tests prove the store
    // isolates tenants, not merely that we asserted a clause shape.
    function seedFindFirst(rows: ReturnType<typeof sampleRow>[]) {
      mockFindFirst.mockImplementation(
        (args: {
          where?: { id?: string; sessionId?: string; organizationId?: string };
          orderBy?: { createdAt?: "asc" | "desc" };
        }) => {
          const where = args.where ?? {};
          let matched = rows.filter(
            (r) =>
              (where.id === undefined || r.id === where.id) &&
              (where.sessionId === undefined || r.sessionId === where.sessionId) &&
              (where.organizationId === undefined || r.organizationId === where.organizationId),
          );
          if (args.orderBy?.createdAt === "desc") {
            matched = [...matched].sort(
              (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
            );
          }
          return Promise.resolve(matched[0] ?? null);
        },
      );
    }

    it("getBySessionId returns only the caller-org row when two orgs share a sessionId", async () => {
      const t0 = new Date("2026-06-01T00:00:00Z");
      seedFindFirst([
        sampleRow({
          id: "hA",
          organizationId: "org_A",
          sessionId: "s1",
          leadSnapshot: { name: "AliceA", channel: "whatsapp" },
          createdAt: t0,
        }),
        sampleRow({
          id: "hB",
          organizationId: "org_B",
          sessionId: "s1",
          leadSnapshot: { name: "BobB", channel: "whatsapp" },
          createdAt: t0,
        }),
      ]);

      const a = await store.getBySessionId("org_A", "s1");
      const b = await store.getBySessionId("org_B", "s1");
      const c = await store.getBySessionId("org_C", "s1");

      expect(a!.id).toBe("hA");
      expect(a!.leadSnapshot.name).toBe("AliceA");
      expect(b!.id).toBe("hB");
      expect(c).toBeNull();
    });

    it("getBySessionId returns the newest matching row within the caller org", async () => {
      seedFindFirst([
        sampleRow({
          id: "old",
          organizationId: "org_A",
          sessionId: "s1",
          createdAt: new Date("2026-06-01T00:00:00Z"),
        }),
        sampleRow({
          id: "new",
          organizationId: "org_A",
          sessionId: "s1",
          createdAt: new Date("2026-06-02T00:00:00Z"),
        }),
      ]);

      const result = await store.getBySessionId("org_A", "s1");
      expect(result!.id).toBe("new");
    });

    it("getById returns only the caller-org row for a shared id", async () => {
      seedFindFirst([sampleRow({ id: "h1", organizationId: "org_A" })]);
      expect((await store.getById("org_A", "h1"))!.organizationId).toBe("org_A");
      expect(await store.getById("org_B", "h1")).toBeNull();
    });
  });

  describe("save()", () => {
    it("persists organizationId on create but never on update (ownership is immutable)", async () => {
      mockUpsert.mockResolvedValue({});
      const now = new Date();
      const pkg: Handoff = {
        id: "h1",
        sessionId: "s1",
        organizationId: "org_1",
        reason: "human_requested",
        status: "pending",
        leadSnapshot: { channel: "whatsapp" },
        qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
        conversationSummary: {
          turnCount: 1,
          keyTopics: [],
          objectionHistory: [],
          sentiment: "neutral",
        },
        slaDeadlineAt: now,
        createdAt: now,
      };

      await store.save(pkg);

      const arg = mockUpsert.mock.calls[0]![0] as {
        where: unknown;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: "h1" });
      expect(arg.create.organizationId).toBe("org_1");
      // A colliding-id save must not be able to move a handoff to another tenant.
      expect(arg.update).not.toHaveProperty("organizationId");
      expect(arg.update).not.toHaveProperty("sessionId");
    });
  });
});
