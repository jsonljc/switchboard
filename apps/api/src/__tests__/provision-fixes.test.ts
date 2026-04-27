import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { organizationsRoutes } from "../routes/organizations.js";

describe("provision route fixes", () => {
  describe("P0-1: webhook path format", () => {
    it("uses the buildManagedWebhookPath helper that mirrors the chat-server route", async () => {
      const { buildManagedWebhookPath } = await import("../lib/managed-webhook-path.js");
      expect(buildManagedWebhookPath("conn_abc12345")).toBe("/webhook/managed/conn_abc12345");
    });
  });

  describe("Meta /subscribed_apps auto-registration (Task 4)", () => {
    let app: FastifyInstance;
    let fetchCalls: Array<{ url: string; init?: RequestInit }>;
    let originalFetch: typeof globalThis.fetch;
    let originalEnv: Record<string, string | undefined>;

    const CUSTOMER_TOKEN = "CUSTOMER_TOKEN_FAKE";
    const APP_TOKEN = "APP_TOKEN_FAKE";
    const VERIFY_TOKEN = "VERIFY_TOKEN_FAKE";
    const CHAT_URL = "https://chat.example.com";

    // Default: every Meta-related call succeeds. Individual tests override.
    function defaultFetchMock(url: string, _init?: RequestInit): Response {
      if (url.includes("debug_token")) {
        return new Response(
          JSON.stringify({
            data: {
              granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA_1"] }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("subscribed_apps")) {
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("provision-notify")) {
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }

    function buildPrismaMock() {
      const connection = {
        id: "conn_abc12345",
        organizationId: "org_test",
      };
      const managedChannel = {
        id: "mc_1",
        organizationId: "org_test",
        channel: "whatsapp",
        connectionId: connection.id,
        botUsername: null,
        webhookPath: `/webhook/managed/${connection.id}`,
        webhookRegistered: false,
        status: "pending",
        statusDetail: null,
        lastHealthCheck: null,
        createdAt: new Date("2026-04-27T00:00:00.000Z"),
        updatedAt: new Date("2026-04-27T00:00:00.000Z"),
      };
      const tx = {
        connection: { create: vi.fn().mockResolvedValue(connection) },
        managedChannel: { create: vi.fn().mockResolvedValue(managedChannel) },
        agentListing: {
          upsert: vi.fn().mockResolvedValue({ id: "listing_1", slug: "alex-conversion" }),
        },
        agentDeployment: { upsert: vi.fn().mockResolvedValue({ id: "dep_1" }) },
        deploymentConnection: { upsert: vi.fn().mockResolvedValue({ id: "dc_1" }) },
      };
      return {
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
        _tx: tx,
      };
    }

    async function buildApp(prismaMock: ReturnType<typeof buildPrismaMock>) {
      const fastify = Fastify({ logger: false });
      fastify.decorate("prisma", prismaMock as unknown as never);
      fastify.decorateRequest("organizationIdFromAuth", undefined);
      fastify.addHook("onRequest", async (request) => {
        request.organizationIdFromAuth = "org_test";
      });
      await fastify.register(organizationsRoutes, {
        prefix: "/api/organizations",
        apiVersion: "v17.0",
      });
      return fastify;
    }

    beforeEach(() => {
      fetchCalls = [];
      originalFetch = globalThis.fetch;
      originalEnv = {
        WHATSAPP_GRAPH_TOKEN: process.env.WHATSAPP_GRAPH_TOKEN,
        WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
        CHAT_PUBLIC_URL: process.env.CHAT_PUBLIC_URL,
        SWITCHBOARD_CHAT_URL: process.env.SWITCHBOARD_CHAT_URL,
        INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
        CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
      };
      process.env.WHATSAPP_GRAPH_TOKEN = APP_TOKEN;
      process.env.WHATSAPP_APP_SECRET = VERIFY_TOKEN;
      process.env.CHAT_PUBLIC_URL = CHAT_URL;
      process.env.CREDENTIALS_ENCRYPTION_KEY =
        process.env.CREDENTIALS_ENCRYPTION_KEY ?? "test-key-for-provision-fixes-12345678";
      delete process.env.SWITCHBOARD_CHAT_URL;
      // Don't trigger provision-notify side effect by default to keep traces simple.
      delete process.env.INTERNAL_API_SECRET;
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      for (const [k, v] of Object.entries(originalEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      if (app) await app.close();
    });

    it("calls Meta /subscribed_apps with Authorization: Bearer <CUSTOMER_TOKEN> (NOT the app token)", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "POST",
        url: "/api/organizations/org_test/provision",
        payload: {
          channels: [
            {
              channel: "whatsapp",
              token: CUSTOMER_TOKEN,
              phoneNumberId: "PHONE_1",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const subscribedAppsCall = fetchCalls.find((c) => c.url.includes("subscribed_apps"));
      expect(subscribedAppsCall).toBeDefined();
      const auth = (subscribedAppsCall!.init?.headers as Record<string, string> | undefined)
        ?.Authorization;
      expect(auth).toBe(`Bearer ${CUSTOMER_TOKEN}`);
      // Defensive: ensure the app token is NEVER sent as the customer-asset bearer.
      expect(auth).not.toBe(`Bearer ${APP_TOKEN}`);
    });

    it("registers a webhook URL using the managed-channel path", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "POST",
        url: "/api/organizations/org_test/provision",
        payload: {
          channels: [{ channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: "PHONE_1" }],
        },
      });

      expect(res.statusCode).toBe(200);
      const subscribedAppsCall = fetchCalls.find((c) => c.url.includes("subscribed_apps"));
      expect(subscribedAppsCall).toBeDefined();
      const body = JSON.parse(subscribedAppsCall!.init!.body as string) as {
        override_callback_uri: string;
        verify_token: string;
      };
      expect(body.override_callback_uri).toMatch(
        /^https:\/\/chat\.example\.com\/webhook\/managed\/conn_[a-zA-Z0-9_-]+$/,
      );
      expect(body.verify_token).toBe(VERIFY_TOKEN);
      // apiVersion plumbed (v17.0 from test harness, NOT a hardcoded v21.0).
      expect(subscribedAppsCall!.url).toContain("/v17.0/");
    });

    it("surfaces status=pending_meta_register with a reason when Meta /subscribed_apps fails", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        if (u.includes("debug_token")) {
          return new Response(
            JSON.stringify({
              data: {
                granular_scopes: [
                  { scope: "whatsapp_business_management", target_ids: ["WABA_1"] },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.includes("subscribed_apps")) {
          return new Response(JSON.stringify({ error: { message: "bad token" } }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("provision-notify")) {
          return new Response("{}", { status: 200 });
        }
        throw new Error(`unexpected fetch ${u}`);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "POST",
        url: "/api/organizations/org_test/provision",
        payload: {
          channels: [{ channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: "PHONE_1" }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        channels: Array<{
          status: string;
          webhookRegistered: boolean;
          statusDetail: string | null;
          id: string | null;
        }>;
      };
      expect(body.channels).toHaveLength(1);
      const ch0 = body.channels[0]!;
      expect(ch0.status).toBe("pending_meta_register");
      expect(ch0.webhookRegistered).toBe(false);
      expect(ch0.statusDetail).toContain("bad token");
      // Channel record is preserved (Decision 5 — Meta failure is not transaction-fatal).
      expect(ch0.id).toBe("mc_1");
    });

    it("sets webhookRegistered=true and status=active when Meta /subscribed_apps returns 2xx", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "POST",
        url: "/api/organizations/org_test/provision",
        payload: {
          channels: [{ channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: "PHONE_1" }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        channels: Array<{ status: string; webhookRegistered: boolean; statusDetail: null }>;
      };
      const ch0 = body.channels[0]!;
      expect(ch0.webhookRegistered).toBe(true);
      // Tasks 5/6 will refine "active" via the precedence resolver. For Task 4,
      // success keeps the existing implicit "active" and only the failure path
      // introduces "pending_meta_register".
      expect(ch0.status).toBe("active");
      expect(ch0.statusDetail).toBeNull();
    });
  });
});
