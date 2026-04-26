import { describe, it, expect, vi, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { leadWebhooksRoutes } from "../lead-webhooks.js";

let app: FastifyInstance;
afterAll(async () => {
  if (app) await app.close();
});

function makeApp(store: Record<string, ReturnType<typeof vi.fn>>) {
  const a = Fastify();
  a.decorate("leadWebhookStore", store);
  // In real production, request.organizationIdFromAuth is set by API auth middleware.
  // For unit tests we set it via a hook so requireOrganizationScope() returns a value.
  a.addHook("preHandler", async (req) => {
    (req as unknown as { organizationIdFromAuth: string }).organizationIdFromAuth = "org_1";
  });
  return a;
}

describe("lead-webhooks routes", () => {
  it("POST creates a webhook and returns plaintext token once", async () => {
    const create = vi.fn(async (input: Record<string, unknown>) => ({
      id: "lwh_1",
      organizationId: "org_1",
      label: input.label,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
      sourceType: input.sourceType,
      greetingTemplateName: input.greetingTemplateName ?? "lead_welcome",
      status: "active",
      lastUsedAt: null,
      createdAt: new Date(),
      revokedAt: null,
    }));
    app = makeApp({ create } as never);
    await app.register(leadWebhooksRoutes, { prefix: "/api" });

    const res = await app.inject({
      method: "POST",
      url: "/api/lead-webhooks",
      payload: { label: "Tally Contact", sourceType: "tally" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^whk_/);
    expect(body.id).toBe("lwh_1");
    expect(body.url).toContain("/api/leads/inbound/whk_");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        label: "Tally Contact",
        sourceType: "tally",
      }),
    );
  });

  it("POST returns 400 for invalid sourceType", async () => {
    app = makeApp({ create: vi.fn() } as never);
    await app.register(leadWebhooksRoutes, { prefix: "/api" });
    const res = await app.inject({
      method: "POST",
      url: "/api/lead-webhooks",
      payload: { label: "x", sourceType: "wechat" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST accepts optional greetingTemplateName", async () => {
    const create = vi.fn(async (input: Record<string, unknown>) => ({
      id: "lwh_zh",
      organizationId: "org_1",
      label: input.label,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
      sourceType: input.sourceType,
      greetingTemplateName: input.greetingTemplateName,
      status: "active",
      lastUsedAt: null,
      createdAt: new Date(),
      revokedAt: null,
    }));
    app = makeApp({ create } as never);
    await app.register(leadWebhooksRoutes, { prefix: "/api" });
    const res = await app.inject({
      method: "POST",
      url: "/api/lead-webhooks",
      payload: { label: "ZH form", sourceType: "tally", greetingTemplateName: "lead_welcome_zh" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().greetingTemplateName).toBe("lead_welcome_zh");
  });

  it("GET lists webhooks for the authenticated org", async () => {
    const listByOrg = vi.fn(async () => [
      {
        id: "a",
        organizationId: "org_1",
        label: "A",
        tokenPrefix: "whk_aaa",
        sourceType: "tally",
        greetingTemplateName: "lead_welcome",
        status: "active",
        lastUsedAt: null,
        createdAt: new Date(),
        revokedAt: null,
        tokenHash: "h",
      },
    ]);
    app = makeApp({ listByOrg } as never);
    await app.register(leadWebhooksRoutes, { prefix: "/api" });
    const res = await app.inject({ method: "GET", url: "/api/lead-webhooks" });
    expect(res.statusCode).toBe(200);
    expect(res.json().webhooks).toHaveLength(1);
    expect(res.json().webhooks[0].tokenHash).toBeUndefined(); // hash never returned
  });

  it("POST revoke calls store.revoke when caller owns the webhook", async () => {
    const revoke = vi.fn(async () => undefined);
    const listByOrg = vi.fn(async () => [
      {
        id: "lwh_1",
        organizationId: "org_1",
        label: "A",
        tokenPrefix: "whk_a",
        sourceType: "tally",
        greetingTemplateName: "lead_welcome",
        status: "active",
        lastUsedAt: null,
        createdAt: new Date(),
        revokedAt: null,
        tokenHash: "h",
      },
    ]);
    app = makeApp({ revoke, listByOrg } as never);
    await app.register(leadWebhooksRoutes, { prefix: "/api" });
    const res = await app.inject({ method: "POST", url: "/api/lead-webhooks/lwh_1/revoke" });
    expect(res.statusCode).toBe(200);
    expect(revoke).toHaveBeenCalledWith("lwh_1");
  });

  it("POST revoke returns 404 when webhook belongs to another org", async () => {
    const revoke = vi.fn(async () => undefined);
    const listByOrg = vi.fn(async () => [] as never[]);
    app = makeApp({ revoke, listByOrg } as never);
    await app.register(leadWebhooksRoutes, { prefix: "/api" });
    const res = await app.inject({ method: "POST", url: "/api/lead-webhooks/lwh_other/revoke" });
    expect(res.statusCode).toBe(404);
    expect(revoke).not.toHaveBeenCalled();
  });
});
