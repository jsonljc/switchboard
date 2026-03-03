import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

const mockCrmProvider = {
  searchContacts: vi.fn(),
  getContact: vi.fn(),
  listDeals: vi.fn(),
  listActivities: vi.fn(),
  getPipelineStatus: vi.fn(),
};

vi.mock("@switchboard/db", () => ({
  PrismaCrmProvider: vi.fn().mockImplementation(() => mockCrmProvider),
}));

import { crmRoutes } from "../routes/crm.js";

describe("CRM API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("prisma", { _mock: true } as any);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(crmRoutes, { prefix: "/api/crm" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/crm/contacts", () => {
    it("returns contacts list", async () => {
      const contacts = [
        { id: "c1", name: "Alice", email: "alice@example.com" },
        { id: "c2", name: "Bob", email: "bob@example.com" },
      ];
      mockCrmProvider.searchContacts.mockResolvedValue(contacts);

      const res = await app.inject({
        method: "GET",
        url: "/api/crm/contacts",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
    });

    it("passes search query to provider", async () => {
      mockCrmProvider.searchContacts.mockResolvedValue([]);

      await app.inject({
        method: "GET",
        url: "/api/crm/contacts?search=alice",
      });

      expect(mockCrmProvider.searchContacts).toHaveBeenCalledWith("alice", expect.any(Number));
    });
  });

  describe("GET /api/crm/contacts/:id", () => {
    it("returns a contact by ID", async () => {
      mockCrmProvider.getContact.mockResolvedValue({
        id: "c1",
        name: "Alice",
        email: "alice@example.com",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/crm/contacts/c1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().contact.name).toBe("Alice");
    });

    it("returns 404 when contact not found", async () => {
      mockCrmProvider.getContact.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/crm/contacts/nonexistent",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not found");
    });
  });

  describe("GET /api/crm/deals", () => {
    it("returns deals with filters", async () => {
      const deals = [{ id: "d1", name: "Deal 1", stage: "negotiation" }];
      mockCrmProvider.listDeals.mockResolvedValue(deals);

      const res = await app.inject({
        method: "GET",
        url: "/api/crm/deals?stage=negotiation",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(1);
      expect(mockCrmProvider.listDeals).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "negotiation" }),
      );
    });
  });

  describe("GET /api/crm/deals/:id", () => {
    it("returns 404 for unknown deal", async () => {
      mockCrmProvider.listDeals.mockResolvedValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/crm/deals/nonexistent",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/crm/activities", () => {
    it("returns activities", async () => {
      const activities = [{ id: "a1", type: "call", contactId: "c1" }];
      mockCrmProvider.listActivities.mockResolvedValue(activities);

      const res = await app.inject({
        method: "GET",
        url: "/api/crm/activities?contactId=c1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(1);
    });
  });

  describe("GET /api/crm/pipeline-status", () => {
    it("returns pipeline status", async () => {
      const stages = [
        { name: "lead", count: 10 },
        { name: "qualified", count: 5 },
      ];
      mockCrmProvider.getPipelineStatus.mockResolvedValue(stages);

      const res = await app.inject({
        method: "GET",
        url: "/api/crm/pipeline-status",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().stages).toHaveLength(2);
    });
  });

  describe("503 when prisma is null", () => {
    it("returns 503 when database is unavailable", async () => {
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("prisma", null);
      app.decorateRequest("organizationIdFromAuth", undefined);
      await app.register(crmRoutes, { prefix: "/api/crm" });

      const res = await app.inject({
        method: "GET",
        url: "/api/crm/contacts",
      });

      expect(res.statusCode).toBe(503);
    });
  });
});
