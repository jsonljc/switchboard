import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const mockDeploymentStore = { findById: vi.fn() };
const mockBusinessFactsStore = { getWithStatus: vi.fn(), upsert: vi.fn() };

vi.mock("@switchboard/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@switchboard/db")>()),
  PrismaDeploymentStore: vi.fn(() => mockDeploymentStore),
  PrismaBusinessFactsStore: vi.fn(() => mockBusinessFactsStore),
}));

import { marketplaceRoutes } from "../marketplace.js";

const VALID_FACTS = {
  businessName: "Glow Aesthetics",
  timezone: "Asia/Singapore",
  locations: [{ name: "Orchard", address: "391 Orchard Rd" }],
  openingHours: { monday: { open: "10:00", close: "20:00", closed: false } },
  services: [{ name: "Botox", description: "Anti-wrinkle", currency: "SGD" }],
  escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6560000000" },
  additionalFaqs: [],
};

function buildApp(orgId: string | null): FastifyInstance {
  const app = Fastify();
  app.decorate("prisma", {} as never);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth: string | null }).organizationIdFromAuth = orgId;
  });
  app.register(marketplaceRoutes);
  return app;
}

describe("PUT /deployments/:id/business-facts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists valid facts keyed to the authenticated org", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "PUT",
      url: "/deployments/dep-1/business-facts",
      payload: VALID_FACTS,
    });
    expect(res.statusCode).toBe(200);
    expect(mockBusinessFactsStore.upsert).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ businessName: "Glow Aesthetics" }),
    );
    await app.close();
  });

  it("rejects a cross-org deployment id (404, no existence leak) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-OTHER" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "PUT",
      url: "/deployments/dep-1/business-facts",
      payload: VALID_FACTS,
    });
    expect(res.statusCode).toBe(404);
    expect(mockBusinessFactsStore.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects invalid facts (400) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "PUT",
      url: "/deployments/dep-1/business-facts",
      payload: { businessName: "X" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockBusinessFactsStore.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when unauthenticated and does NOT write", async () => {
    const app = buildApp(null);
    const res = await app.inject({
      method: "PUT",
      url: "/deployments/dep-1/business-facts",
      payload: VALID_FACTS,
    });
    expect(res.statusCode).toBe(401);
    expect(mockBusinessFactsStore.upsert).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("GET /deployments/:id/business-facts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { config, status }", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockBusinessFactsStore.getWithStatus.mockResolvedValue({
      facts: VALID_FACTS,
      status: "present",
    });
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/business-facts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ config: VALID_FACTS, status: "present" });
    await app.close();
  });

  it("rejects a cross-org deployment id (404) and does not read", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-OTHER" });
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/business-facts" });
    expect(res.statusCode).toBe(404);
    expect(mockBusinessFactsStore.getWithStatus).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp(null);
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/business-facts" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
