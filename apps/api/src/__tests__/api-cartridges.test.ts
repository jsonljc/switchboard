import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { cartridgesRoutes } from "../routes/cartridges.js";

describe("Cartridges API", () => {
  let app: FastifyInstance;

  const mockCartridges = {
    list: vi.fn(),
    get: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });
    app.decorate("storageContext", { cartridges: mockCartridges } as unknown as never);
    await app.register(cartridgesRoutes, { prefix: "/api/cartridges" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/cartridges", () => {
    it("returns manifests for all registered cartridges", async () => {
      const manifest1 = { id: "digital-ads", name: "Digital Ads", actions: [] };
      const manifest2 = { id: "crm", name: "CRM", actions: [] };

      mockCartridges.list.mockReturnValue(["digital-ads", "crm"]);
      mockCartridges.get.mockImplementation((id: string) => {
        if (id === "digital-ads") return { manifest: manifest1 };
        if (id === "crm") return { manifest: manifest2 };
        return undefined;
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/cartridges",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cartridges).toHaveLength(2);
      expect(body.cartridges[0].id).toBe("digital-ads");
      expect(body.cartridges[1].id).toBe("crm");
    });

    it("returns empty array when no cartridges are registered", async () => {
      mockCartridges.list.mockReturnValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/cartridges",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cartridges).toEqual([]);
    });

    it("filters out cartridges with null manifests", async () => {
      const manifest1 = { id: "digital-ads", name: "Digital Ads", actions: [] };

      mockCartridges.list.mockReturnValue(["digital-ads", "broken"]);
      mockCartridges.get.mockImplementation((id: string) => {
        if (id === "digital-ads") return { manifest: manifest1 };
        if (id === "broken") return { manifest: null };
        return undefined;
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/cartridges",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cartridges).toHaveLength(1);
      expect(body.cartridges[0].id).toBe("digital-ads");
    });
  });
});
