// N1/N2 — provision route persists the resolved channel status and is
// idempotent on a same-channel resubmit.
//
// N1 (persist status): the provision route computes resolveProvisionStatus but
// historically only pushed it into the HTTP results[] array. The ManagedChannel
// row kept its schema default "provisioning" forever, so a reload via
// GET /channels showed "provisioning" with no reason — a partial WhatsApp-
// connect failure was opaque. These tests pin that the resolved
// status/statusDetail/webhookRegistered are written back to the row (and that a
// throw after row creation persists status:"error" + the message).
//
// N2 (idempotent resubmit): the schema enforces
// @@unique([organizationId, channel]); a bare create on a resubmit would throw
// P2002 and be unrecoverable. The checkV1ChannelLimit precheck short-circuits
// before the create, so the documented "Please retry" repair returns the
// existing row idempotently instead of a 500. This pins that contract.
//
// PATTERN NOTE: mirrors the inline-Fastify, prisma-mock, and fetch-mock house
// style from provision-fixes.test.ts / provision-end-to-end.test.ts. No new
// harness abstraction is introduced.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { organizationsRoutes } from "../routes/organizations.js";

const CUSTOMER_TOKEN = "CUSTOMER_TOKEN_FAKE";
const APP_TOKEN = "APP_TOKEN_FAKE";
const VERIFY_TOKEN = "VERIFY_TOKEN_FAKE";
const CHAT_URL = "https://chat.example.com";

describe("provision route — persist status (N1) + idempotent resubmit (N2)", () => {
  let app: FastifyInstance;
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: Record<string, string | undefined>;

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
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("provision-notify")) {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (/graph\.facebook\.com\/v[\d.]+\/PHONE_/.test(url)) {
      return new Response(JSON.stringify({ id: "phone_1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }

  function buildPrismaMock() {
    const connection = { id: "conn_abc12345", organizationId: "org_test" };
    const managedChannel = {
      id: "mc_1",
      organizationId: "org_test",
      channel: "whatsapp",
      connectionId: connection.id,
      botUsername: null,
      webhookPath: `/webhook/managed/${connection.id}`,
      webhookRegistered: false,
      status: "provisioning",
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
      agentDeployment: {
        upsert: vi.fn().mockResolvedValue({ id: "dep_1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      deploymentConnection: { upsert: vi.fn().mockResolvedValue({ id: "dc_1" }) },
    };
    return {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      connection: {
        update: vi.fn().mockResolvedValue({ ...connection }),
        // The v1-limit precheck reads the existing Connection's encrypted
        // credentials. Default null (first-time provision); the idempotency
        // test overrides this.
        findUnique: vi.fn().mockResolvedValue(null),
      },
      managedChannel: {
        update: vi.fn().mockResolvedValue({ ...managedChannel }),
        // Precheck findFirst — null short-circuits it for first-time provisions.
        findFirst: vi.fn().mockResolvedValue(null),
      },
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
    process.env.INTERNAL_API_SECRET = "internal-secret-test";
    process.env.CREDENTIALS_ENCRYPTION_KEY =
      process.env.CREDENTIALS_ENCRYPTION_KEY ?? "test-key-for-provision-persist-12345678";
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

  // ── N1: persist the resolved status back to the ManagedChannel row ──

  it("persists status=pending_meta_register back to the row (matches the response)", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      fetchCalls.push({ url: u, init });
      if (u.includes("debug_token")) {
        return new Response(
          JSON.stringify({
            data: {
              granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA_1"] }],
            },
          }),
          { status: 200 },
        );
      }
      if (u.includes("subscribed_apps")) {
        return new Response(JSON.stringify({ error: { message: "bad token" } }), { status: 400 });
      }
      if (u.includes("provision-notify")) {
        return new Response("{}", { status: 200 });
      }
      if (/graph\.facebook\.com\/v[\d.]+\/PHONE_/.test(u)) {
        return new Response(JSON.stringify({ id: "phone_1" }), { status: 200 });
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
    const body = res.json() as { channels: Array<{ status: string; statusDetail: string | null }> };
    const ch0 = body.channels[0]!;
    expect(ch0.status).toBe("pending_meta_register");

    // The persisted row must carry the SAME status the response reported, so a
    // later GET /channels reflects reality rather than the default
    // "provisioning".
    const statusWrite = prisma.managedChannel.update.mock.calls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status !== undefined,
    );
    expect(statusWrite, "expected a managedChannel.update that writes status").toBeDefined();
    const writeArg = statusWrite![0] as {
      where: { id: string };
      data: { status: string; statusDetail: string | null; webhookRegistered: boolean };
    };
    expect(writeArg.where.id).toBe("mc_1");
    expect(writeArg.data.status).toBe(ch0.status);
    expect(writeArg.data.statusDetail).toBe(ch0.statusDetail);
    expect(writeArg.data.webhookRegistered).toBe(false);
  });

  it("persists status=active + webhookRegistered=true on the golden path", async () => {
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
    const statusWrite = prisma.managedChannel.update.mock.calls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status !== undefined,
    );
    expect(statusWrite).toBeDefined();
    const writeArg = statusWrite![0] as { data: { status: string; webhookRegistered: boolean } };
    expect(writeArg.data.status).toBe("active");
    expect(writeArg.data.webhookRegistered).toBe(true);
  });

  it("persists status=error with the thrown message when a step throws after row creation", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      fetchCalls.push({ url: u, init });
      return defaultFetchMock(u, init);
    }) as typeof globalThis.fetch;

    const prisma = buildPrismaMock();
    // Force a throw AFTER the row is created but during post-create work, so the
    // catch has a persisted row id to update. connection.update (the health-probe
    // persist) is the first prisma call after the transaction returns the row.
    prisma.connection.update.mockRejectedValueOnce(new Error("boom during probe persist"));
    app = await buildApp(prisma);

    const res = await app.inject({
      method: "POST",
      url: "/api/organizations/org_test/provision",
      payload: {
        channels: [{ channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: "PHONE_1" }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { channels: Array<{ status: string; statusDetail: string | null }> };
    expect(body.channels[0]!.status).toBe("error");

    // The catch must persist status:"error" + the message onto the created row
    // so the failure is not opaque after reload.
    const errorWrite = prisma.managedChannel.update.mock.calls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === "error",
    );
    expect(errorWrite, "expected a managedChannel.update writing status:error").toBeDefined();
    const writeArg = errorWrite![0] as {
      where: { id: string };
      data: { status: string; statusDetail: string };
    };
    expect(writeArg.where.id).toBe("mc_1");
    expect(writeArg.data.statusDetail).toContain("boom during probe persist");
  });

  // ── N2: re-submitting the same WhatsApp channel must not 500 (no P2002) ──

  it("POSTing the same whatsapp channel twice succeeds (no P2002) and creates the row only once", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      fetchCalls.push({ url: u, init });
      return defaultFetchMock(u, init);
    }) as typeof globalThis.fetch;

    const prisma = buildPrismaMock();
    // Model "first creates, second finds": findFirst returns null until the
    // create runs, then returns the persisted row. connection.findUnique returns
    // a row whose decrypted creds carry the SAME phoneNumberId so the precheck
    // resolves to existing_idempotent (not v1-limit reject).
    let created = false;
    const { encryptCredentials } = await import("@switchboard/db");
    const sameCreds = encryptCredentials({ token: CUSTOMER_TOKEN, phoneNumberId: "PHONE_1" });
    const existingRow = {
      id: "mc_1",
      organizationId: "org_test",
      channel: "whatsapp",
      connectionId: "conn_abc12345",
      botUsername: null,
      webhookPath: "/webhook/managed/conn_abc12345",
      webhookRegistered: false,
      status: "provisioning",
      statusDetail: null,
      lastHealthCheck: null,
      createdAt: new Date("2026-04-27T00:00:00.000Z"),
      updatedAt: new Date("2026-04-27T00:00:00.000Z"),
    };
    prisma._tx.managedChannel.create.mockImplementation(async () => {
      created = true;
      return { ...existingRow };
    });
    prisma.managedChannel.findFirst.mockImplementation(async () =>
      created ? { ...existingRow } : null,
    );
    prisma.connection.findUnique.mockImplementation(async () =>
      created ? { id: "conn_abc12345", organizationId: "org_test", credentials: sameCreds } : null,
    );
    app = await buildApp(prisma);

    const payload = {
      channels: [{ channel: "whatsapp", token: CUSTOMER_TOKEN, phoneNumberId: "PHONE_1" }],
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/organizations/org_test/provision",
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/organizations/org_test/provision",
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstBody = first.json() as { channels: Array<{ id: string; status: string }> };
    const secondBody = second.json() as {
      channels: Array<{ id: string; status: string; statusDetail: string | null }>;
    };
    // No 500 / P2002 leaked into either response.
    expect(firstBody.channels[0]!.status).not.toBe("error");
    expect(secondBody.channels[0]!.status).not.toBe("error");
    // Same row returned; create ran exactly once across both requests.
    expect(secondBody.channels[0]!.id).toBe(firstBody.channels[0]!.id);
    expect(prisma._tx.managedChannel.create).toHaveBeenCalledTimes(1);
  });

  // ── N2 honest-status: a resubmit of an error-state channel must honestly
  //    report "error" + reason, not falsely report "active". ──
  //
  // Before this fix, the existing_idempotent branch in checkV1ChannelLimit
  // hardcoded status:"active" / "existing channel returned" regardless of the
  // row's real persisted status. After a partial failure N1 persists
  // status:"error" onto the row, but a retry received a falsely-active HTTP
  // response while the DB row stayed "error" — a lie to the operator.
  //
  // This test ensures the fix is effective: with the old hardcoded behavior,
  // the `expect(secondBody.channels[0]!.status).toBe("error")` assertion below
  // would FAIL (it would receive "active" instead).
  it("N2 honest-status: resubmitting an error-state channel returns the real persisted error status, not a false active", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      fetchCalls.push({ url: u, init });
      return defaultFetchMock(u, init);
    }) as typeof globalThis.fetch;

    const prisma = buildPrismaMock();
    const { encryptCredentials } = await import("@switchboard/db");
    const sameCreds = encryptCredentials({ token: CUSTOMER_TOKEN, phoneNumberId: "PHONE_1" });

    // The row is already in error state (e.g. from a previous partial failure
    // where N1 persisted status:"error"). This simulates a row that exists but
    // failed to fully activate.
    const errorRow = {
      id: "mc_1",
      organizationId: "org_test",
      channel: "whatsapp",
      connectionId: "conn_abc12345",
      botUsername: null,
      webhookPath: "/webhook/managed/conn_abc12345",
      webhookRegistered: false,
      status: "error",
      statusDetail: "webhook registration failed: upstream rejected",
      lastHealthCheck: null,
      createdAt: new Date("2026-04-27T00:00:00.000Z"),
      updatedAt: new Date("2026-04-27T00:00:00.000Z"),
    };

    // findFirst immediately returns the error-state row (already exists from a
    // previous failed provision attempt).
    prisma.managedChannel.findFirst.mockResolvedValue({ ...errorRow });
    prisma.connection.findUnique.mockResolvedValue({
      id: "conn_abc12345",
      organizationId: "org_test",
      credentials: sameCreds,
    });
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
      channels: Array<{ id: string; status: string; statusDetail: string | null }>;
    };
    const ch = body.channels[0]!;

    // Honest report: the row is "error", the response must reflect that.
    // With the OLD hardcoded behavior this would have been "active" — a lie.
    expect(ch.status).toBe("error");
    expect(ch.statusDetail).toBe("webhook registration failed: upstream rejected");
    expect(ch.id).toBe("mc_1");

    // The idempotent branch must NOT re-run any provision side effects.
    expect(prisma._tx.managedChannel.create).not.toHaveBeenCalled();
    expect(prisma._tx.connection.create).not.toHaveBeenCalled();
    const metaCalls = fetchCalls.filter(
      (c) => c.url.includes("debug_token") || c.url.includes("subscribed_apps"),
    );
    expect(metaCalls).toHaveLength(0);
  });
});
