import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { internalIngressRoutes } from "../routes/internal-ingress.js";
import { buildTestServer } from "./test-server.js";

const SECRET = "test-internal-secret";
const BASE = {
  organizationId: "org_a",
  actor: { id: "wa:+6591234567", type: "user" as const },
  intent: "alex.respond",
  parameters: { message: "hi" },
  trigger: "chat" as const,
  surface: { surface: "chat" as const, sessionId: "+6591234567" },
};

/** Minimal app with the REAL auth middleware + a spy platformIngress. */
async function buildApp(opts: { authEnabled: boolean }): Promise<{
  app: FastifyInstance;
  submit: ReturnType<typeof vi.fn>;
}> {
  const submit = vi.fn().mockResolvedValue({ ok: true, result: {}, workUnit: {} });
  const app = Fastify();
  app.decorate("prisma", null);
  // API_KEYS present -> authDisabled=false (auth enabled); absent -> authDisabled=true.
  vi.stubEnv("API_KEYS", opts.authEnabled ? "k" : "");
  await app.register(authMiddleware);
  app.decorate("platformIngress", { submit } as never);
  await app.register(internalIngressRoutes, { prefix: "/api/internal/ingress" });
  await app.ready();
  return { app, submit };
}

describe("POST /api/internal/ingress/submit (F-15)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is excluded from API-key auth and enforces the internal secret (no header -> 401 Unauthorized)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app } = await buildApp({ authEnabled: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      payload: BASE,
    });
    // If the allowlist failed, the auth middleware would answer "Missing Authorization header".
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Unauthorized");
    await app.close();
  });

  it("rejects a wrong secret with 401", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: "Bearer nope" },
      payload: BASE,
    });
    expect(res.statusCode).toBe(401);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts the correct secret and submits under the BODY org (not an auth-key org)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: BASE,
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a", intent: "alex.respond" }),
    );
    await app.close();
  });

  it("serves multiple tenants with ONE secret (multi-tenant proof)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    for (const org of ["org_a", "org_b"]) {
      await app.inject({
        method: "POST",
        url: "/api/internal/ingress/submit",
        headers: { authorization: `Bearer ${SECRET}` },
        payload: { ...BASE, organizationId: org },
      });
    }
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_a" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_b" }));
    await app.close();
  });

  it("forwards Spec-1A lineage + idempotency key to submit", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: {
        ...BASE,
        contactId: "contact_1",
        conversationThreadId: "thread_1",
        idempotencyKey: "org_a:whatsapp:wamid.1",
      },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact_1",
        conversationThreadId: "thread_1",
        idempotencyKey: "org_a:whatsapp:wamid.1",
      }),
    );
    await app.close();
  });

  it("rejects a malformed body (missing organizationId) with 400 and does not submit", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    const { organizationId: _omit, ...noOrg } = BASE;
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: noOrg,
    });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("503s when the secret is unset and auth is enabled (fail closed)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const { app, submit } = await buildApp({ authEnabled: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      payload: BASE,
    });
    expect(res.statusCode).toBe(503);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts without a secret in pure dev mode (no DB, no keys -> authDisabled)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const { app, submit } = await buildApp({ authEnabled: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      payload: BASE,
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_a" }));
    await app.close();
  });

  it("wired: an authenticated submit reaches the REAL PlatformIngress (unknown intent -> intent_not_found)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app } = await buildTestServer();
    await app.register(internalIngressRoutes, { prefix: "/api/internal/ingress" });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: { ...BASE, intent: "does.not.exist" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.type).toBe("intent_not_found");
    await app.close();
  });
});
