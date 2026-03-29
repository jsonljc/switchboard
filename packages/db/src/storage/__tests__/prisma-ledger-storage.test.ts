import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaLedgerStorage } from "../prisma-ledger-storage.js";

function createMockPrisma() {
  return {
    auditEntry: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
}

const NOW = new Date("2025-01-01");

const TEST_ENTRY = {
  id: "entry_1",
  eventType: "action.executed" as const,
  timestamp: NOW,
  actorType: "agent" as const,
  actorId: "agent_1",
  entityType: "envelope",
  entityId: "env_1",
  riskCategory: "medium" as const,
  visibilityLevel: "internal" as const,
  summary: "Executed ad creation",
  snapshot: { foo: "bar" },
  evidencePointers: [],
  redactionApplied: false,
  redactedFields: [],
  chainHashVersion: 1,
  schemaVersion: 1,
  entryHash: "abc123",
  previousEntryHash: null,
  envelopeId: "env_1",
  organizationId: "org_1",
  traceId: null,
};

const TEST_DB_ROW = { ...TEST_ENTRY };

describe("PrismaLedgerStorage", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let storage: PrismaLedgerStorage;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
    storage = new PrismaLedgerStorage(prisma as any);
  });

  describe("append", () => {
    it("creates audit entry", async () => {
      prisma.auditEntry.create.mockResolvedValue({});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test data matches interface
      await storage.append(TEST_ENTRY as any);

      expect(prisma.auditEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "entry_1",
          eventType: "action.executed",
          actorType: "agent",
          actorId: "agent_1",
          entityType: "envelope",
          entityId: "env_1",
          entryHash: "abc123",
          previousEntryHash: null,
        }),
      });
    });
  });

  describe("getLatest", () => {
    it("returns latest entry ordered by timestamp desc", async () => {
      prisma.auditEntry.findFirst.mockResolvedValue(TEST_DB_ROW);

      const result = await storage.getLatest();
      expect(result).not.toBeNull();
      expect(result!.id).toBe("entry_1");
      expect(result!.eventType).toBe("action.executed");
      expect(prisma.auditEntry.findFirst).toHaveBeenCalledWith({
        orderBy: { timestamp: "desc" },
      });
    });

    it("returns null when no entries exist", async () => {
      prisma.auditEntry.findFirst.mockResolvedValue(null);

      const result = await storage.getLatest();
      expect(result).toBeNull();
    });
  });

  describe("getById", () => {
    it("returns entry when found", async () => {
      prisma.auditEntry.findUnique.mockResolvedValue(TEST_DB_ROW);

      const result = await storage.getById("entry_1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("entry_1");
      expect(prisma.auditEntry.findUnique).toHaveBeenCalledWith({
        where: { id: "entry_1" },
      });
    });

    it("returns null when not found", async () => {
      prisma.auditEntry.findUnique.mockResolvedValue(null);

      const result = await storage.getById("missing");
      expect(result).toBeNull();
    });
  });

  describe("query", () => {
    it("queries with eventType filter", async () => {
      prisma.auditEntry.findMany.mockResolvedValue([TEST_DB_ROW]);

      const result = await storage.query({ eventType: "action.executed" });
      expect(result).toHaveLength(1);
      expect(prisma.auditEntry.findMany).toHaveBeenCalledWith({
        where: { eventType: "action.executed" },
        orderBy: { timestamp: "asc" },
        take: undefined,
        skip: undefined,
      });
    });

    it("queries with time range filters", async () => {
      prisma.auditEntry.findMany.mockResolvedValue([]);
      const after = new Date("2025-01-01");
      const before = new Date("2025-12-31");

      await storage.query({ after, before });

      expect(prisma.auditEntry.findMany).toHaveBeenCalledWith({
        where: {
          timestamp: { gt: after, lt: before },
        },
        orderBy: { timestamp: "asc" },
        take: undefined,
        skip: undefined,
      });
    });

    it("queries with pagination (limit and offset)", async () => {
      prisma.auditEntry.findMany.mockResolvedValue([]);

      await storage.query({ limit: 10, offset: 5 });

      expect(prisma.auditEntry.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { timestamp: "asc" },
        take: 10,
        skip: 5,
      });
    });

    it("queries with multiple filters", async () => {
      prisma.auditEntry.findMany.mockResolvedValue([]);

      await storage.query({
        entityType: "envelope",
        entityId: "env_1",
        organizationId: "org_1",
        envelopeId: "env_1",
      });

      expect(prisma.auditEntry.findMany).toHaveBeenCalledWith({
        where: {
          entityType: "envelope",
          entityId: "env_1",
          organizationId: "org_1",
          envelopeId: "env_1",
        },
        orderBy: { timestamp: "asc" },
        take: undefined,
        skip: undefined,
      });
    });
  });

  describe("appendAtomic", () => {
    it("executes within a transaction with advisory lock", async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        auditEntry: {
          findFirst: vi.fn().mockResolvedValue({ entryHash: "prev_hash" }),
          create: vi.fn().mockResolvedValue({}),
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock transaction callback
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        return fn(mockTx);
      });

      const buildEntry = vi.fn().mockResolvedValue(TEST_ENTRY);

      const result = await storage.appendAtomic(buildEntry);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockTx.$queryRaw).toHaveBeenCalled();
      expect(mockTx.auditEntry.findFirst).toHaveBeenCalledWith({
        orderBy: { timestamp: "desc" },
      });
      expect(buildEntry).toHaveBeenCalledWith("prev_hash");
      expect(mockTx.auditEntry.create).toHaveBeenCalled();
      expect(result).toEqual(TEST_ENTRY);
    });

    it("passes null previousEntryHash when no latest entry", async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        auditEntry: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock transaction callback
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        return fn(mockTx);
      });

      const buildEntry = vi.fn().mockResolvedValue(TEST_ENTRY);

      await storage.appendAtomic(buildEntry);

      expect(buildEntry).toHaveBeenCalledWith(null);
    });
  });
});
