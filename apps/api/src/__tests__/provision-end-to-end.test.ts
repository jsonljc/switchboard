// End-to-end provisioning integration test (Task 9).
//
// SCOPE NOTE — cross-app boundary:
// This test does NOT simulate inbound webhook delivery to apps/chat. The
// chat-side route pin lives in apps/chat/src/__tests__/whatsapp-wiring.test.ts
// (Task 2). Here we assert the API-side persisted webhookPath and the
// connection/managedChannel identifiers; full cross-process inbound simulation
// is the territory of a higher-level e2e harness (out of scope for this
// branch).
//
// PATTERN NOTE: this file deliberately mirrors the inline-Fastify, prisma-mock,
// and fetch-mock patterns from provision-fixes.test.ts. No new harness
// abstraction is introduced — match the existing house style.
//
// Acceptance criteria mapping is at the bottom of the file (A1–A8 → tests).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { organizationsRoutes } from "../routes/organizations.js";

const ORG_ID = "org_e2e_test";
const CUSTOMER_TOKEN = "CUSTOMER_TOKEN_E2E";
const PHONE_NUMBER_ID = "PHONE_E2E";
const APP_TOKEN_FAKE = "APP_TOKEN_E2E";
const VERIFY_TOKEN_FAKE = "VERIFY_TOKEN_E2E";
const CHAT_PUBLIC_URL = "https://chat.example.com";
const INTERNAL_API_SECRET = "internal-secret-e2e";
const API_VERSION = "v17.0";

describe("provision end-to-end (standard provision path, A1–A8)", () => {
  let app: FastifyInstance;
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: Record<string, string | undefined>;

  // Default fetch: every Meta-related call succeeds. Individual tests override.
  function defaultFetchMock(url: string, _init?: RequestInit): Response {
    if (url.includes("debug_token")) {
      return new Response(
        JSON.stringify({
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA_E2E"] }],
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
    if (/graph\.facebook\.com\/v[\d.]+\/PHONE_/.test(url)) {
      return new Response(JSON.stringify({ id: "phone_e2e" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }

  function buildPrismaMock() {
    const connection = {
      id: "conn_e2e1234",
      organizationId: ORG_ID,
    };
    const managedChannel = {
      id: "mc_e2e",
      organizationId: ORG_ID,
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
    const orgConfig = {
      id: ORG_ID,
      name: "",
      runtimeType: "http",
      runtimeConfig: {},
      governanceProfile: "guarded",
      onboardingComplete: false,
      managedChannels: [],
      provisioningStatus: "pending",
      createdAt: new Date("2026-04-27T00:00:00.000Z"),
      updatedAt: new Date("2026-04-27T00:00:00.000Z"),
    };
    // ── Task 10: v1-limit precheck state ──
    // The route now calls managedChannel.findFirst at the top of the per-
    // channel loop. We model "first request creates, second request finds"
    // by tracking creates in a closure: findFirst returns null until the
    // create runs, and afterwards returns the row with the encrypted creds
    // that the route persisted (so the precheck can decrypt and compare
    // phoneNumberId for the WhatsApp same-vs-different number distinction).
    let storedCredentials: string | null = null;
    const tx = {
      connection: {
        create: vi.fn(async (args: { data: { credentials: string } }) => {
          storedCredentials = args.data.credentials;
          return connection;
        }),
      },
      managedChannel: { create: vi.fn().mockResolvedValue(managedChannel) },
      agentListing: {
        upsert: vi.fn().mockResolvedValue({ id: "listing_alex", slug: "alex-conversion" }),
      },
      agentDeployment: { upsert: vi.fn().mockResolvedValue({ id: "deployment_alex" }) },
      deploymentConnection: { upsert: vi.fn().mockResolvedValue({ id: "dc_e2e" }) },
    };
    return {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      connection: {
        update: vi.fn().mockResolvedValue({ ...connection }),
        // Task 10: precheck reads the existing Connection's encrypted
        // credentials to decrypt + compare phoneNumberId. We resolve it from
        // the closure populated by tx.connection.create above, so the second
        // request sees the same encrypted blob the first request persisted.
        findUnique: vi.fn(async () => {
          if (storedCredentials === null) return null;
          return { ...connection, credentials: storedCredentials };
        }),
      },
      managedChannel: {
        update: vi.fn().mockResolvedValue({ ...managedChannel }),
        // findFirst returns null until tx.connection.create has run, then
        // returns the persisted ManagedChannel row.
        findFirst: vi.fn(async () => {
          if (storedCredentials === null) return null;
          return { ...managedChannel };
        }),
      },
      organizationConfig: {
        upsert: vi.fn().mockResolvedValue(orgConfig),
        findUnique: vi.fn().mockResolvedValue(orgConfig),
      },
      agentListing: {
        upsert: vi.fn().mockResolvedValue({ id: "listing_alex", slug: "alex-conversion" }),
      },
      agentDeployment: { upsert: vi.fn().mockResolvedValue({ id: "deployment_alex" }) },
      _tx: tx,
      _connection: connection,
      _managedChannel: managedChannel,
    };
  }

  async function buildApp(prismaMock: ReturnType<typeof buildPrismaMock>) {
    const fastify = Fastify({ logger: false });
    fastify.decorate("prisma", prismaMock as unknown as never);
    fastify.decorateRequest("organizationIdFromAuth", undefined);
    fastify.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = ORG_ID;
    });
    await fastify.register(organizationsRoutes, {
      prefix: "/api/organizations",
      apiVersion: API_VERSION,
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
    process.env.WHATSAPP_GRAPH_TOKEN = APP_TOKEN_FAKE;
    process.env.WHATSAPP_APP_SECRET = VERIFY_TOKEN_FAKE;
    process.env.CHAT_PUBLIC_URL = CHAT_PUBLIC_URL;
    process.env.INTERNAL_API_SECRET = INTERNAL_API_SECRET;
    process.env.CREDENTIALS_ENCRYPTION_KEY =
      process.env.CREDENTIALS_ENCRYPTION_KEY ?? "test-key-for-provision-e2e-12345678";
    delete process.env.SWITCHBOARD_CHAT_URL;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (app) await app.close();
  });

  describe("golden path", () => {
    it("brand-new org sees Alex via lazy config access; standard provision lands at status=active with all steps green", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      // ── Step 1: GET /config seeds Alex (covers A7) ──
      const configRes = await app.inject({
        method: "GET",
        url: `/api/organizations/${ORG_ID}/config`,
      });
      expect(configRes.statusCode).toBe(200);
      expect(prisma.agentListing.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: "alex-conversion" } }),
      );
      expect(prisma.agentDeployment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_listingId: {
              organizationId: ORG_ID,
              listingId: "listing_alex",
            },
          },
        }),
      );

      // ── Step 2: POST /provision with WhatsApp credentials ──
      const provisionRes = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload: {
          channels: [
            {
              channel: "whatsapp",
              token: CUSTOMER_TOKEN,
              phoneNumberId: PHONE_NUMBER_ID,
            },
          ],
        },
      });

      expect(provisionRes.statusCode).toBe(200);
      const body = provisionRes.json() as {
        channels: Array<{
          id: string;
          status: string;
          statusDetail: string | null;
          webhookPath: string;
          webhookRegistered: boolean;
          lastHealthCheck: string | null;
        }>;
      };
      expect(body.channels).toHaveLength(1);
      const ch = body.channels[0]!;

      // A1 + A6: status=active means full chain (Meta validate, register,
      // health probe, chat notify) succeeded with no founder DB edits.
      expect(ch.status).toBe("active");
      expect(ch.statusDetail).toBeNull();

      // A3 (API half): persisted webhookPath matches /webhook/managed/<connId>.
      expect(ch.webhookPath).toMatch(/^\/webhook\/managed\/[a-zA-Z0-9_-]+$/);
      expect(ch.webhookRegistered).toBe(true);

      // A5: lastHealthCheck is a valid ISO string and was written to both
      // Connection and ManagedChannel as a Date.
      expect(ch.lastHealthCheck).toBeTruthy();
      expect(new Date(ch.lastHealthCheck!).toISOString()).toBe(ch.lastHealthCheck);
      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastHealthCheck: expect.any(Date) }),
        }),
      );
      expect(prisma.managedChannel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastHealthCheck: expect.any(Date) }),
        }),
      );

      // A1 token model: debug_token uses app token; subscribed_apps uses customer token.
      const debugCall = fetchCalls.find((c) => c.url.includes("debug_token"));
      expect(debugCall).toBeDefined();
      expect(debugCall!.url).toContain(`input_token=${CUSTOMER_TOKEN}`);
      expect(debugCall!.url).toContain(`access_token=${APP_TOKEN_FAKE}`);

      const subAppsCall = fetchCalls.find((c) => c.url.includes("subscribed_apps"));
      expect(subAppsCall).toBeDefined();
      expect(
        (subAppsCall!.init?.headers as Record<string, string> | undefined)?.Authorization,
      ).toBe(`Bearer ${CUSTOMER_TOKEN}`);

      // A5 token model: health probe uses customer token at the apiVersion plumbed in.
      const probeCall = fetchCalls.find((c) =>
        new RegExp(`graph\\.facebook\\.com/${API_VERSION}/${PHONE_NUMBER_ID}`).test(c.url),
      );
      expect(probeCall).toBeDefined();
      expect((probeCall!.init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
        `Bearer ${CUSTOMER_TOKEN}`,
      );

      // A6: provision-notify invoked exactly once on the success path, with
      // managedChannelId in the body.
      const notifyCalls = fetchCalls.filter((c) => c.url.includes("provision-notify"));
      expect(notifyCalls).toHaveLength(1);
      const notifyBody = JSON.parse(notifyCalls[0]!.init!.body as string) as {
        managedChannelId?: string;
      };
      expect(notifyBody.managedChannelId).toBe(ch.id);
    });

    it("A4: same-(org,channel,phoneNumberId) retry returns existing row idempotently — no duplicate create, no re-run side effects", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const payload = {
        channels: [{ channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: PHONE_NUMBER_ID }],
      };

      const first = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload,
      });
      const second = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload,
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);

      const firstBody = first.json() as {
        channels: Array<{ id: string; status: string; statusDetail: string | null }>;
      };
      const secondBody = second.json() as {
        channels: Array<{ id: string; status: string; statusDetail: string | null }>;
      };

      // Strict route-level idempotency: same id returned on retry.
      expect(secondBody.channels[0]!.id).toBe(firstBody.channels[0]!.id);

      // tx.managedChannel.create called exactly once across the two requests.
      expect(prisma._tx.managedChannel.create).toHaveBeenCalledTimes(1);
      expect(prisma._tx.connection.create).toHaveBeenCalledTimes(1);

      // Explicit precheck signal.
      expect(secondBody.channels[0]!.status).toBe("active");
      expect(secondBody.channels[0]!.statusDetail).toBe("existing channel returned");

      // Side effects are NOT re-run for the second request: exactly one of
      // each Meta call (debug_token + subscribed_apps), one provision-notify,
      // and one health probe across both requests combined.
      const debugCalls = fetchCalls.filter((c) => c.url.includes("debug_token"));
      const subAppsCalls = fetchCalls.filter((c) => c.url.includes("subscribed_apps"));
      const notifyCalls = fetchCalls.filter((c) => c.url.includes("provision-notify"));
      const probeCalls = fetchCalls.filter((c) =>
        /graph\.facebook\.com\/v[\d.]+\/PHONE_/.test(c.url),
      );
      expect(debugCalls).toHaveLength(1);
      expect(subAppsCalls).toHaveLength(1);
      expect(notifyCalls).toHaveLength(1);
      expect(probeCalls).toHaveLength(1);
    });

    it("Task 10: different phoneNumberId for an org with an existing WhatsApp channel is rejected with v1-limit message — no overwrite, no new row, no Meta calls", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const first = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload: {
          channels: [{ channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: "1111" }],
        },
      });
      expect(first.statusCode).toBe(200);

      // Snapshot fetch counts after the first (successful) provision so we
      // can assert the second request triggers no additional Meta/notify/probe
      // traffic.
      const callsAfterFirst = fetchCalls.length;

      const second = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload: {
          channels: [{ channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: "2222" }],
        },
      });
      expect(second.statusCode).toBe(200);

      const secondBody = second.json() as {
        channels: Array<{
          id: string;
          status: string;
          statusDetail: string | null;
          webhookRegistered: boolean;
          lastHealthCheck: string | null;
        }>;
      };
      const ch = secondBody.channels[0]!;
      expect(ch.status).toBe("error");
      const detail = ch.statusDetail ?? "";
      expect(detail).toContain("v1 limit");
      expect(detail).toContain("WhatsApp");
      // statusDetail must NOT leak the phoneNumberId of either side.
      expect(detail).not.toContain("2222");
      expect(detail).not.toContain("1111");
      expect(ch.webhookRegistered).toBe(false);
      expect(ch.lastHealthCheck).toBeNull();

      // No new row created; no fetch traffic from the second request.
      expect(prisma._tx.managedChannel.create).toHaveBeenCalledTimes(1);
      expect(prisma._tx.connection.create).toHaveBeenCalledTimes(1);
      expect(fetchCalls.length).toBe(callsAfterFirst);
    });
  });

  describe("failure paths (A8: failure states surface to the user)", () => {
    it("Meta /subscribed_apps failure returns status=pending_meta_register with statusDetail", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        if (u.includes("subscribed_apps")) {
          return new Response(JSON.stringify({ error: { message: "bad token" } }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload: {
          channels: [
            { channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: PHONE_NUMBER_ID },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        channels: Array<{
          status: string;
          statusDetail: string | null;
          webhookRegistered: boolean;
        }>;
      };
      const ch = body.channels[0]!;
      expect(ch.status).toBe("pending_meta_register");
      expect(ch.statusDetail).toContain("bad token");
      expect(ch.webhookRegistered).toBe(false);
    });

    it("provision-notify retry-then-fail returns status=pending_chat_register with statusDetail and exactly two notify calls", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        if (u.includes("provision-notify")) {
          return new Response("nope", { status: 502 });
        }
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload: {
          channels: [
            { channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: PHONE_NUMBER_ID },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        channels: Array<{ status: string; statusDetail: string | null }>;
      };
      const ch = body.channels[0]!;
      expect(ch.status).toBe("pending_chat_register");
      expect(ch.statusDetail).toMatch(/Provision-notify failed after retry/);
      const notifyCalls = fetchCalls.filter((c) => c.url.includes("provision-notify"));
      expect(notifyCalls).toHaveLength(2);
    });

    it("missing chat env vars returns status=config_error with statusDetail naming the missing config and skips provision-notify", async () => {
      delete process.env.CHAT_PUBLIC_URL;
      delete process.env.SWITCHBOARD_CHAT_URL;
      delete process.env.INTERNAL_API_SECRET;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload: {
          channels: [
            { channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: PHONE_NUMBER_ID },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        channels: Array<{ status: string; statusDetail: string | null }>;
      };
      const ch = body.channels[0]!;
      expect(ch.status).toBe("config_error");
      expect(ch.statusDetail).toMatch(/CHAT_PUBLIC_URL/);
      expect(ch.statusDetail).toMatch(/INTERNAL_API_SECRET/);
      const notifyCalls = fetchCalls.filter((c) => c.url.includes("provision-notify"));
      expect(notifyCalls).toHaveLength(0);
    });

    it("health probe failure returns status=health_check_failed with statusDetail and lastHealthCheck=null", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        fetchCalls.push({ url: u, init });
        if (/graph\.facebook\.com\/v[\d.]+\/PHONE_/.test(u)) {
          return new Response("forbidden", { status: 401 });
        }
        return defaultFetchMock(u, init);
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "POST",
        url: `/api/organizations/${ORG_ID}/provision`,
        payload: {
          channels: [
            { channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: PHONE_NUMBER_ID },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        channels: Array<{
          status: string;
          statusDetail: string | null;
          lastHealthCheck: string | null;
        }>;
      };
      const ch = body.channels[0]!;
      expect(ch.status).toBe("health_check_failed");
      expect(ch.statusDetail).toMatch(/401|health probe/i);
      expect(ch.lastHealthCheck).toBeNull();
    });
  });

  describe("Alex marketplace seeding (A7, standalone)", () => {
    it("brand-new org sees Alex listing via lazy config access even before any channel is provisioned", async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error("no fetch should occur on /config");
      }) as typeof globalThis.fetch;

      const prisma = buildPrismaMock();
      app = await buildApp(prisma);

      const res = await app.inject({
        method: "GET",
        url: `/api/organizations/${ORG_ID}/config`,
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.agentListing.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.agentListing.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: "alex-conversion" } }),
      );
      expect(prisma.agentDeployment.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.agentDeployment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_listingId: {
              organizationId: ORG_ID,
              listingId: "listing_alex",
            },
          },
        }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance criteria mapping (spec: docs/superpowers/specs/2026-04-27-fix-launch-webhook-provisioning-design.md)
// ─────────────────────────────────────────────────────────────────────────────
// A1 — "brand-new org sees Alex via lazy config access; standard provision
//       lands at status=active with all steps green" (debug_token + subscribed_apps
//       token-model assertions prove no founder DB edits required).
// A2 — Backend half: every failure-path test asserts statusDetail is non-null
//       when status !== "active". Component (dashboard) half is Task 11.
// A3 — API half: golden-path test asserts webhookPath matches
//       /^\/webhook\/managed\/[a-zA-Z0-9_-]+$/ and webhookRegistered=true.
//       Cross-process inbound simulation deferred (see top-of-file scope note;
//       chat-side route pin lives in apps/chat/src/__tests__/whatsapp-wiring.test.ts).
// A4 — Strict retry-idempotency: same (orgId, channel, phoneNumberId) retry
//       returns the existing row id, calls managedChannel.create exactly once
//       across both requests, and re-runs zero side effects (Meta, notify,
//       health probe). Plus the v1-limit replacement-attempt rejection test:
//       a different phoneNumberId for an org with an existing WhatsApp
//       channel returns status=error with a v1-limit statusDetail that does
//       not leak the phoneNumberId of either side.
// A5 — Golden-path test: lastHealthCheck is a valid ISO string in the
//       response, and prisma.connection.update + prisma.managedChannel.update
//       were called with a Date. Negative path: health-probe-failure test
//       asserts lastHealthCheck=null on probe 401.
// A6 — Golden-path test: provision-notify fetched exactly once with
//       managedChannelId in body. Failure half: notify-retry-then-fail test
//       asserts pending_chat_register with two notify calls.
// A7 — Golden-path test (lazy upsert seeds Alex listing+deployment) PLUS
//       standalone "brand-new org sees Alex listing" test that proves Alex
//       seeding is independent of any /provision call.
// A8 — All four failure-path tests: each asserts a non-active status with a
//       non-null statusDetail (pending_meta_register, pending_chat_register,
//       config_error, health_check_failed).
