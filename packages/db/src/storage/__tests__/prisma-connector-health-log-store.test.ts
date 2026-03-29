import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConnectorHealthLogStore } from "../prisma-connector-health-log-store.js";

describe("PrismaConnectorHealthLogStore", () => {
  const mockCreate = vi.fn();
  const mockFindFirst = vi.fn();
  const mockFindMany = vi.fn();

  const mockPrisma = {
    connectorHealthLog: {
      create: mockCreate,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
  } as any;

  let store: PrismaConnectorHealthLogStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PrismaConnectorHealthLogStore(mockPrisma);
  });

  describe("log()", () => {
    it("creates a new health log entry", async () => {
      mockCreate.mockResolvedValue({});

      await store.log({
        organizationId: "org_1",
        connectorId: "meta-ads",
        connectorName: "Meta Ads",
        status: "connected",
        matchRate: 0.95,
        errorMessage: null,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          organizationId: "org_1",
          connectorId: "meta-ads",
          connectorName: "Meta Ads",
          status: "connected",
          matchRate: 0.95,
          errorMessage: null,
        },
      });
    });
  });

  describe("getLatest()", () => {
    it("returns the latest entry for org + connector", async () => {
      mockFindFirst.mockResolvedValue({
        id: "log_1",
        organizationId: "org_1",
        connectorId: "meta-ads",
        connectorName: "Meta Ads",
        status: "connected",
        matchRate: 0.9,
        errorMessage: null,
        checkedAt: new Date("2024-01-01T00:00:00Z"),
      });

      const result = await store.getLatest("org_1", "meta-ads");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("log_1");
      expect(result!.status).toBe("connected");
      expect(result!.checkedAt).toBe("2024-01-01T00:00:00.000Z");
    });

    it("returns null when no entry exists", async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await store.getLatest("org_1", "meta-ads");
      expect(result).toBeNull();
    });
  });

  describe("listByOrg()", () => {
    it("returns deduplicated entries per connector", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: "log_2",
          organizationId: "org_1",
          connectorId: "meta-ads",
          connectorName: "Meta Ads",
          status: "connected",
          matchRate: 0.95,
          errorMessage: null,
          checkedAt: new Date("2024-01-02T00:00:00Z"),
        },
        {
          id: "log_1",
          organizationId: "org_1",
          connectorId: "meta-ads",
          connectorName: "Meta Ads",
          status: "degraded",
          matchRate: 0.8,
          errorMessage: null,
          checkedAt: new Date("2024-01-01T00:00:00Z"),
        },
        {
          id: "log_3",
          organizationId: "org_1",
          connectorId: "crm",
          connectorName: "CRM",
          status: "connected",
          matchRate: 1.0,
          errorMessage: null,
          checkedAt: new Date("2024-01-02T00:00:00Z"),
        },
      ]);

      const result = await store.listByOrg("org_1");

      // Should only return the latest per connector
      expect(result).toHaveLength(2);
      expect(result[0]!.connectorId).toBe("meta-ads");
      expect(result[0]!.status).toBe("connected"); // latest
      expect(result[1]!.connectorId).toBe("crm");
    });
  });
});
