import { describe, it, expect, vi, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { leadsInboundRoutes } from "../leads-inbound.js";

function makeApp(
  overrides: {
    findByTokenHash?: ReturnType<typeof vi.fn>;
    submit?: ReturnType<typeof vi.fn>;
    touchLastUsed?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const app = Fastify();
  app.decorate("redis", null);
  app.decorate("platformIngress", {
    submit:
      overrides.submit ??
      vi.fn(async () => ({
        ok: true,
        workUnit: { id: "wu_xyz", traceId: "tr_xyz" },
      })),
  });
  app.decorate("leadWebhookStore", {
    findByTokenHash:
      overrides.findByTokenHash ??
      vi.fn(async (h: string) =>
        h === "valid-hash"
          ? {
              id: "lwh_1",
              organizationId: "org_1",
              tokenPrefix: "whk_aaaaaa",
              sourceType: "tally",
              status: "active",
              greetingTemplateName: "lead_welcome",
            }
          : null,
      ),
    touchLastUsed: overrides.touchLastUsed ?? vi.fn(async () => undefined),
  });
  return app;
}

let app: FastifyInstance;
afterAll(async () => {
  if (app) await app.close();
});

describe("POST /api/leads/inbound/:webhookToken", () => {
  it("returns 401 for unknown token", async () => {
    app = makeApp();
    await app.register(leadsInboundRoutes, { prefix: "/api" });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/inbound/whk_unknown",
      payload: { data: { fields: [] } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when no phone or email after normalization", async () => {
    app = makeApp({
      findByTokenHash: vi.fn(async () => ({
        id: "lwh_1",
        organizationId: "org_1",
        tokenPrefix: "whk_a",
        sourceType: "tally",
        status: "active",
        greetingTemplateName: "lead_welcome",
      })),
    });
    await app.register(leadsInboundRoutes, { prefix: "/api" });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/inbound/whk_anything",
      payload: { data: { fields: [{ label: "Favourite", value: "blue" }] } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_contact" });
  });

  it("returns 202 with workUnitId on success", async () => {
    const submit = vi.fn(async () => ({
      ok: true,
      workUnit: { id: "wu_xyz", traceId: "tr_xyz" },
    }));
    app = makeApp({
      findByTokenHash: vi.fn(async () => ({
        id: "lwh_1",
        organizationId: "org_1",
        tokenPrefix: "whk_a",
        sourceType: "tally",
        status: "active",
        greetingTemplateName: "lead_welcome",
      })),
      submit,
    });
    await app.register(leadsInboundRoutes, { prefix: "/api" });

    const res = await app.inject({
      method: "POST",
      url: "/api/leads/inbound/whk_valid",
      payload: {
        data: {
          fields: [
            { label: "Phone", value: "+6591234567" },
            { label: "Name", value: "Sarah" },
          ],
          formId: "form_xyz",
        },
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ received: true, workUnitId: "wu_xyz", traceId: "tr_xyz" });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "website.lead.intake",
        organizationId: "org_1",
        parameters: expect.objectContaining({ phone: "+6591234567", name: "Sarah" }),
      }),
    );
  });

  it("returns 400 invalid_phone when phone normalization fails", async () => {
    app = makeApp({
      findByTokenHash: vi.fn(async () => ({
        id: "lwh_1",
        organizationId: "org_1",
        tokenPrefix: "whk_a",
        sourceType: "tally",
        status: "active",
        greetingTemplateName: "lead_welcome",
      })),
    });
    await app.register(leadsInboundRoutes, { prefix: "/api" });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/inbound/whk_valid",
      payload: { data: { fields: [{ label: "Phone", value: "12345" }] } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_phone");
  });

  it("returns 500 when platformIngress.submit fails", async () => {
    app = makeApp({
      findByTokenHash: vi.fn(async () => ({
        id: "lwh_1",
        organizationId: "org_1",
        tokenPrefix: "whk_a",
        sourceType: "tally",
        status: "active",
        greetingTemplateName: "lead_welcome",
      })),
      submit: vi.fn(async () => ({ ok: false, error: { message: "boom" } })),
    });
    await app.register(leadsInboundRoutes, { prefix: "/api" });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/inbound/whk_valid",
      payload: { data: { fields: [{ label: "Phone", value: "+6591234567" }] } },
    });
    expect(res.statusCode).toBe(500);
  });

  it("uses webhook's greetingTemplateName in the submitted parameters", async () => {
    const submit = vi.fn(async () => ({
      ok: true,
      workUnit: { id: "wu_xyz", traceId: "tr_xyz" },
    }));
    app = makeApp({
      findByTokenHash: vi.fn(async () => ({
        id: "lwh_1",
        organizationId: "org_1",
        tokenPrefix: "whk_a",
        sourceType: "tally",
        status: "active",
        greetingTemplateName: "lead_welcome_zh",
      })),
      submit,
    });
    await app.register(leadsInboundRoutes, { prefix: "/api" });
    await app.inject({
      method: "POST",
      url: "/api/leads/inbound/whk_valid",
      payload: { data: { fields: [{ label: "Phone", value: "+6591234567" }] } },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({ greetingTemplateName: "lead_welcome_zh" }),
      }),
    );
  });
});
