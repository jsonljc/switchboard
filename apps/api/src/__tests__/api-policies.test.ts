import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("Policies API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/policies", () => {
    it("should create a policy and return 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/policies",
        payload: {
          name: "Test Policy",
          description: "A test policy",
          organizationId: null,
          cartridgeId: "ads-spend",
          priority: 1,
          active: true,
          rule: {
            composition: "AND",
            conditions: [{ field: "actionType", operator: "eq", value: "ads.campaign.pause" }],
          },
          effect: "require_approval",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.policy).toBeDefined();
      expect(body.policy.id).toBeDefined();
      expect(body.policy.name).toBe("Test Policy");
    });

    it("should return 400 for invalid policy body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/policies",
        payload: {
          name: "Missing required fields",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });
  });

  describe("GET /api/policies", () => {
    it("should list seeded and created policies", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/policies",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Should have at least the 2 seeded DEFAULT_ADS_POLICIES
      expect(body.policies.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by cartridgeId", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/policies?cartridgeId=ads-spend",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.policies.length).toBeGreaterThanOrEqual(2);
      for (const policy of body.policies) {
        expect(policy.cartridgeId).toBe("ads-spend");
      }
    });
  });

  describe("GET /api/policies/:id", () => {
    it("should return 200 for existing policy", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/policies/ads-large-budget-increase",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.policy.id).toBe("ads-large-budget-increase");
    });

    it("should return 404 for non-existent policy", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/policies/non-existent-id",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /api/policies/:id", () => {
    it("should update a policy and return 200", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/policies/ads-large-budget-increase",
        payload: {
          name: "Updated Policy Name",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.policy.name).toBe("Updated Policy Name");
    });
  });

  describe("DELETE /api/policies/:id", () => {
    it("should delete a policy and subsequent get returns 404", async () => {
      // Create a policy to delete
      const createRes = await app.inject({
        method: "POST",
        url: "/api/policies",
        payload: {
          name: "To Delete",
          description: "Will be deleted",
          organizationId: null,
          cartridgeId: "ads-spend",
          priority: 1,
          active: true,
          rule: {
            composition: "AND",
            conditions: [{ field: "actionType", operator: "eq", value: "test" }],
          },
          effect: "deny",
        },
      });
      const policyId = createRes.json().policy.id;

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/policies/${policyId}`,
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().deleted).toBe(true);

      // Verify it's gone
      const getRes = await app.inject({
        method: "GET",
        url: `/api/policies/${policyId}`,
      });
      expect(getRes.statusCode).toBe(404);
    });
  });
});
