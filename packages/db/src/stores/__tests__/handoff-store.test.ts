import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaHandoffStore } from "../handoff-store.js";

describe("PrismaHandoffStore", () => {
  const mockUpsert = vi.fn();
  const mockFindUnique = vi.fn();
  const mockFindFirst = vi.fn();
  const mockFindMany = vi.fn();
  const mockUpdate = vi.fn();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockPrisma = {
    handoff: {
      upsert: mockUpsert,
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      update: mockUpdate,
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  let store: PrismaHandoffStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PrismaHandoffStore(mockPrisma);
  });

  describe("listPending()", () => {
    it("queries for pending/assigned/active handoffs ordered by slaDeadlineAt", async () => {
      const now = new Date();
      const rows = [
        {
          id: "h1",
          sessionId: "s1",
          organizationId: "org_1",
          status: "pending",
          reason: "human_requested",
          leadSnapshot: { name: "Alice", channel: "whatsapp" },
          qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "mql" },
          conversationSummary: {
            turnCount: 5,
            keyTopics: ["pricing"],
            objectionHistory: [],
            sentiment: "neutral",
          },
          slaDeadlineAt: now,
          acknowledgedAt: null,
          createdAt: now,
        },
        {
          id: "h2",
          sessionId: "s2",
          organizationId: "org_1",
          status: "active",
          reason: "complex_objection",
          leadSnapshot: { name: "Bob", channel: "telegram" },
          qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "sql" },
          conversationSummary: {
            turnCount: 10,
            keyTopics: ["contract"],
            objectionHistory: ["too expensive"],
            sentiment: "negative",
          },
          slaDeadlineAt: new Date(now.getTime() + 60_000),
          acknowledgedAt: null,
          createdAt: now,
        },
      ];
      mockFindMany.mockResolvedValue(rows);

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
      expect(result[0]!.status).toBe("pending");
      expect(result[0]!.reason).toBe("human_requested");
      expect(result[1]!.id).toBe("h2");
      expect(result[1]!.status).toBe("active");
    });

    it("returns empty array when no pending handoffs exist", async () => {
      mockFindMany.mockResolvedValue([]);
      const result = await store.listPending("org_empty");
      expect(result).toEqual([]);
    });
  });

  describe("updateStatus()", () => {
    it("updates status without acknowledgedAt", async () => {
      mockUpdate.mockResolvedValue({});

      await store.updateStatus("h1", "released");

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "h1" },
        data: { status: "released" },
      });
    });

    it("updates status with acknowledgedAt", async () => {
      mockUpdate.mockResolvedValue({});
      const ackDate = new Date("2026-03-18T12:00:00Z");

      await store.updateStatus("h1", "assigned", ackDate);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "h1" },
        data: { status: "assigned", acknowledgedAt: ackDate },
      });
    });
  });

  describe("getById()", () => {
    it("returns null when not found", async () => {
      mockFindUnique.mockResolvedValue(null);
      const result = await store.getById("nonexistent");
      expect(result).toBeNull();
    });

    it("maps row to HandoffPackage", async () => {
      const now = new Date();
      mockFindUnique.mockResolvedValue({
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
      });

      const result = await store.getById("h1");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("h1");
      expect(result!.acknowledgedAt).toBeUndefined();
      expect(result!.leadSnapshot.name).toBe("Alice");
    });
  });
});
