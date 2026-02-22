import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("Identity API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/identity/specs", () => {
    it("should create an identity spec and return 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/identity/specs",
        payload: {
          principalId: "user_new",
          organizationId: null,
          name: "New User",
          description: "A new identity spec",
          riskTolerance: {
            none: "none",
            low: "none",
            medium: "standard",
            high: "elevated",
            critical: "mandatory",
          },
          globalSpendLimits: { daily: 5000, weekly: null, monthly: null, perAction: 1000 },
          cartridgeSpendLimits: {},
          forbiddenBehaviors: [],
          trustBehaviors: [],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.spec).toBeDefined();
      expect(body.spec.id).toBeDefined();
      expect(body.spec.principalId).toBe("user_new");
    });

    it("should return 400 for invalid spec body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/identity/specs",
        payload: {
          name: "Missing required fields",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });
  });

  describe("GET /api/identity/specs/:id", () => {
    it("should return 200 for existing spec", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/identity/specs/spec_default",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.spec.id).toBe("spec_default");
      expect(body.spec.principalId).toBe("default");
    });

    it("should return 404 for non-existent spec", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/identity/specs/non-existent-id",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/identity/specs/by-principal/:principalId", () => {
    it("should return spec by principalId", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/identity/specs/by-principal/default",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.spec.principalId).toBe("default");
    });
  });

  describe("PUT /api/identity/specs/:id", () => {
    it("should update spec fields", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/identity/specs/spec_default",
        payload: {
          name: "Updated Name",
          description: "Updated description",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.spec.name).toBe("Updated Name");
      expect(body.spec.description).toBe("Updated description");
    });
  });

  describe("POST /api/identity/overlays", () => {
    it("should create an overlay and return 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/identity/overlays",
        payload: {
          identitySpecId: "spec_default",
          name: "Test Overlay",
          description: "A test overlay",
          mode: "restrict",
          priority: 10,
          active: true,
          conditions: {},
          overrides: { forbiddenBehaviors: ["ads.budget.adjust"] },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.overlay).toBeDefined();
      expect(body.overlay.id).toBeDefined();
      expect(body.overlay.identitySpecId).toBe("spec_default");
    });
  });

  describe("GET /api/identity/overlays", () => {
    it("should list overlays by specId", async () => {
      // Create an overlay first
      await app.inject({
        method: "POST",
        url: "/api/identity/overlays",
        payload: {
          identitySpecId: "spec_default",
          name: "Test Overlay",
          description: "A test overlay",
          mode: "restrict",
          priority: 10,
          active: true,
          conditions: {},
          overrides: {},
        },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/identity/overlays?specId=spec_default",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.overlays.length).toBeGreaterThanOrEqual(1);
    });

    it("should return 400 when specId is missing", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/identity/overlays",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("specId");
    });
  });

  describe("PUT /api/identity/overlays/:id", () => {
    it("should update an overlay and return 200", async () => {
      // Create an overlay first
      const createRes = await app.inject({
        method: "POST",
        url: "/api/identity/overlays",
        payload: {
          identitySpecId: "spec_default",
          name: "Original Name",
          description: "Original",
          mode: "restrict",
          priority: 10,
          active: true,
          conditions: {},
          overrides: {},
        },
      });
      const overlayId = createRes.json().overlay.id;

      const res = await app.inject({
        method: "PUT",
        url: `/api/identity/overlays/${overlayId}`,
        payload: {
          identitySpecId: "spec_default",
          name: "Updated Overlay",
          description: "Updated",
          mode: "restrict",
          priority: 20,
          active: true,
          conditions: {},
          overrides: {},
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.overlay.name).toBe("Updated Overlay");
      expect(body.overlay.priority).toBe(20);
    });
  });
});
