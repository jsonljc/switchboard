import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Partial-mock @switchboard/db: keep every real export, but replace the orchestrator
// with a spy so we can assert the route wires it correctly and swallows its errors.
// vi.mock is hoisted above imports, so the spy must be created via vi.hoisted (a plain
// const would be in the temporal dead zone when the hoisted factory runs).
const { provisionSpy } = vi.hoisted(() => ({ provisionSpy: vi.fn() }));

vi.mock("@switchboard/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@switchboard/db")>();
  return { ...actual, provisionOrgAgentDeployments: provisionSpy };
});

import { organizationsRoutes } from "../routes/organizations.js";

describe("Organizations API — day-one Riley provisioning seam", () => {
  let app: FastifyInstance;

  const mockPrisma = {
    organizationConfig: {
      upsert: vi.fn().mockResolvedValue({ id: "org_test", name: "" }),
    },
    agentListing: {
      upsert: vi.fn().mockResolvedValue({ id: "listing_alex", slug: "alex-conversion" }),
    },
    agentDeployment: {
      upsert: vi.fn().mockResolvedValue({ id: "deployment_alex" }),
      update: vi.fn().mockResolvedValue({}),
    },
    orgAgentEnablement: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    knowledgeEntry: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    provisionSpy.mockResolvedValue({ riley: { deploymentId: "deploy_riley" } });
    app = Fastify({ logger: false });
    app.decorate("prisma", mockPrisma as unknown as never);
    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });
    await app.register(organizationsRoutes, { prefix: "/api/organizations" });
  });

  it("provisions Riley (mira:false) on first config access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/organizations/org_test/config" });
    expect(res.statusCode).toBe(200);
    expect(provisionSpy).toHaveBeenCalledTimes(1);
    expect(provisionSpy).toHaveBeenCalledWith(mockPrisma, "org_test", { mira: false });
  });

  it("swallows a provisioning failure and still returns the config (200)", async () => {
    provisionSpy.mockRejectedValueOnce(new Error("transient db error"));
    const res = await app.inject({ method: "GET", url: "/api/organizations/org_test/config" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).config).toBeDefined();
  });
});
