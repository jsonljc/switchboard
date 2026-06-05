import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaBusinessFactsStore } from "../prisma-business-facts-store.js";
import type { BusinessFacts } from "@switchboard/schemas";

function makeFacts(overrides: Partial<BusinessFacts> = {}): BusinessFacts {
  return {
    businessName: "Glow Dental",
    timezone: "Asia/Singapore",
    locations: [{ name: "Main", address: "123 Orchard Rd" }],
    openingHours: {
      monday: { open: "09:00", close: "18:00", closed: false },
    },
    services: [{ name: "Cleaning", description: "Standard teeth cleaning", currency: "SGD" }],
    escalationContact: { name: "Dr Tan", channel: "whatsapp" as const, address: "+6591234567" },
    additionalFaqs: [],
    ...overrides,
  };
}

function makePrisma() {
  return {
    businessConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe("PrismaBusinessFactsStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaBusinessFactsStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaBusinessFactsStore(prisma as never);
  });

  describe("get", () => {
    it("returns null when no config exists", async () => {
      prisma.businessConfig.findUnique.mockResolvedValue(null);
      const result = await store.get("org_1");
      expect(result).toBeNull();
      expect(prisma.businessConfig.findUnique).toHaveBeenCalledWith({
        where: { organizationId: "org_1" },
      });
    });

    it("returns parsed BusinessFacts when config exists", async () => {
      const facts = makeFacts();
      prisma.businessConfig.findUnique.mockResolvedValue({
        id: "bc_1",
        organizationId: "org_1",
        config: facts,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await store.get("org_1");
      expect(result).toEqual(facts);
    });
  });

  describe("upsert", () => {
    it("upserts business facts into config column", async () => {
      const facts = makeFacts();
      prisma.businessConfig.upsert.mockResolvedValue({});
      await store.upsert("org_1", facts);
      expect(prisma.businessConfig.upsert).toHaveBeenCalledWith({
        where: { organizationId: "org_1" },
        create: { organizationId: "org_1", config: facts },
        update: { config: facts },
      });
    });
  });

  describe("getWithStatus", () => {
    it("returns 'present' with parsed facts for a valid config", async () => {
      const facts = makeFacts();
      prisma.businessConfig.findUnique.mockResolvedValue({
        organizationId: "org_1",
        config: facts,
      });
      const result = await store.getWithStatus("org_1");
      expect(result.status).toBe("present");
      expect(result.facts).toEqual(facts);
    });

    it("returns 'missing' when no row exists", async () => {
      prisma.businessConfig.findUnique.mockResolvedValue(null);
      const result = await store.getWithStatus("org_1");
      expect(result.status).toBe("missing");
      expect(result.facts).toBeNull();
    });

    it("returns 'missing' when config is an empty object", async () => {
      prisma.businessConfig.findUnique.mockResolvedValue({ organizationId: "org_1", config: {} });
      expect((await store.getWithStatus("org_1")).status).toBe("missing");
    });

    it("returns 'malformed' (not missing) for a non-object array config", async () => {
      prisma.businessConfig.findUnique.mockResolvedValue({ organizationId: "org_1", config: [] });
      expect((await store.getWithStatus("org_1")).status).toBe("malformed");
    });

    it("returns 'malformed' with sanitized issues for an invalid config", async () => {
      prisma.businessConfig.findUnique.mockResolvedValue({
        organizationId: "org_1",
        config: { businessName: "X" },
      });
      const result = await store.getWithStatus("org_1");
      expect(result.status).toBe("malformed");
      expect(result.facts).toBeNull();
      expect(result.issues && result.issues.length).toBeGreaterThan(0);
    });
  });

  describe("get (runtime degrade)", () => {
    it("returns null and warns (sanitized: issues only, never the raw config)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.businessConfig.findUnique.mockResolvedValue({
        organizationId: "org_1",
        config: {
          businessName: "X",
          escalationContact: { name: "A", channel: "whatsapp", address: "+65SECRET999" },
        },
      });
      const result = await store.get("org_1");
      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        "[BusinessFacts] malformed BusinessConfig.config",
        expect.objectContaining({
          organizationId: "org_1",
          issues: expect.arrayContaining([
            expect.objectContaining({ path: expect.any(String), code: expect.any(String) }),
          ]),
        }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain("+65SECRET999");
      warn.mockRestore();
    });
  });
});
