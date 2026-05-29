import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappTemplateCreateRoutes } from "../whatsapp-template-create.js";

const ORG = "org_dev";
const WABA = "103516422734968";

function buildApp(opts: { connection?: unknown }): FastifyInstance {
  const app = Fastify();
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = ORG;
  });
  (app as unknown as { prisma: unknown }).prisma = {
    connection: { findFirst: async () => opts.connection ?? null },
  };
  return app;
}

const validBody = {
  name: "order_update",
  language: "en_US",
  category: "MARKETING",
  body: { text: "Hello {{1}}.", examples: ["Ada"] },
};

describe("POST /templates", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.stubEnv("META_SYSTEM_USER_TOKEN", "test-token");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (app) await app.close();
  });

  it("creates a template and returns PENDING", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ id: "123", status: "PENDING", category: "MARKETING" }), {
        status: 200,
      })) as unknown as typeof fetch;
    app = buildApp({ connection: { externalAccountId: WABA } });
    await app.register(whatsappTemplateCreateRoutes, { graphApiFetch: fetchImpl });
    const res = await app.inject({ method: "POST", url: "/templates", payload: validBody });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "123", status: "PENDING", category: "MARKETING" });
  });

  it("400s on an invalid request body", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    app = buildApp({ connection: { externalAccountId: WABA } });
    await app.register(whatsappTemplateCreateRoutes, { graphApiFetch: fetchImpl });
    const res = await app.inject({
      method: "POST",
      url: "/templates",
      payload: { ...validBody, name: "Bad Name" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("WHATSAPP_BAD_REQUEST");
  });

  it("404s when no whatsapp connection exists", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    app = buildApp({ connection: null });
    await app.register(whatsappTemplateCreateRoutes, { graphApiFetch: fetchImpl });
    const res = await app.inject({ method: "POST", url: "/templates", payload: validBody });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("WHATSAPP_NOT_CONNECTED");
  });

  it("maps Meta code 100 to a 400 WHATSAPP_TEMPLATE_INVALID", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { code: 100, message: "Invalid parameter" } }), {
        status: 400,
      })) as unknown as typeof fetch;
    app = buildApp({ connection: { externalAccountId: WABA } });
    await app.register(whatsappTemplateCreateRoutes, { graphApiFetch: fetchImpl });
    const res = await app.inject({ method: "POST", url: "/templates", payload: validBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("WHATSAPP_TEMPLATE_INVALID");
    expect(res.json().error.message).toContain("Invalid parameter");
  });
});
