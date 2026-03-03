import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { competenceRoutes } from "../routes/competence.js";

describe("Competence API", () => {
  let app: FastifyInstance;

  const mockCompetence = {
    listRecords: vi.fn(),
    getRecord: vi.fn(),
  };

  const mockCompetencePolicy = {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const mockPrisma = {
    competencePolicy: mockCompetencePolicy,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("prisma", mockPrisma as any);
    app.decorate("storageContext", { competence: mockCompetence } as any);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(competenceRoutes, { prefix: "/api/competence" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/competence/records", () => {
    it("returns paginated records for a principal", async () => {
      const records = [
        { principalId: "user_1", actionType: "execute", score: 0.8 },
        { principalId: "user_1", actionType: "approve", score: 0.9 },
      ];
      mockCompetence.listRecords.mockResolvedValue(records);

      const res = await app.inject({
        method: "GET",
        url: "/api/competence/records?principalId=user_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it("returns empty when no principalId is provided", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/competence/records",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  describe("GET /api/competence/records/:principalId/:actionType", () => {
    it("returns a specific competence record", async () => {
      const record = { principalId: "user_1", actionType: "execute", score: 0.8 };
      mockCompetence.getRecord.mockResolvedValue(record);

      const res = await app.inject({
        method: "GET",
        url: "/api/competence/records/user_1/execute",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().record.score).toBe(0.8);
    });

    it("returns 404 when record not found", async () => {
      mockCompetence.getRecord.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/competence/records/user_1/nonexistent",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not found");
    });
  });

  describe("GET /api/competence/policies", () => {
    it("returns competence policies", async () => {
      const policies = [{ id: "pol_1", name: "Default", enabled: true }];
      mockCompetencePolicy.findMany.mockResolvedValue(policies);

      const res = await app.inject({
        method: "GET",
        url: "/api/competence/policies",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().policies).toHaveLength(1);
    });

    it("returns 503 when prisma is unavailable", async () => {
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("prisma", null);
      app.decorate("storageContext", { competence: mockCompetence } as any);
      app.decorateRequest("organizationIdFromAuth", undefined);
      await app.register(competenceRoutes, { prefix: "/api/competence" });

      const res = await app.inject({
        method: "GET",
        url: "/api/competence/policies",
      });

      expect(res.statusCode).toBe(503);
    });
  });

  describe("POST /api/competence/policies", () => {
    it("creates a competence policy", async () => {
      const created = {
        id: "pol_new",
        name: "High Risk Policy",
        description: "For high risk actions",
        thresholds: { minScore: 0.9 },
        enabled: true,
      };
      mockCompetencePolicy.create.mockResolvedValue(created);

      const res = await app.inject({
        method: "POST",
        url: "/api/competence/policies",
        payload: {
          name: "High Risk Policy",
          description: "For high risk actions",
          thresholds: { minScore: 0.9 },
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().policy.name).toBe("High Risk Policy");
    });
  });

  describe("PUT /api/competence/policies/:id", () => {
    it("updates a competence policy", async () => {
      mockCompetencePolicy.update.mockResolvedValue({
        id: "pol_1",
        name: "Updated Policy",
        enabled: false,
      });

      const res = await app.inject({
        method: "PUT",
        url: "/api/competence/policies/pol_1",
        payload: { name: "Updated Policy", enabled: false },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().policy.name).toBe("Updated Policy");
    });
  });

  describe("DELETE /api/competence/policies/:id", () => {
    it("deletes a competence policy", async () => {
      mockCompetencePolicy.delete.mockResolvedValue({});

      const res = await app.inject({
        method: "DELETE",
        url: "/api/competence/policies/pol_1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(true);
    });
  });
});
