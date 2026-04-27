import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappOnboardingRoutes } from "../whatsapp-onboarding.js";

describe("WhatsApp onboarding routes", () => {
  let app: FastifyInstance;
  const mockGraphApi = vi.fn();
  const mockCreateConnection = vi.fn();

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(whatsappOnboardingRoutes, {
      metaSystemUserToken: "suat_test",
      metaSystemUserId: "sys_user_123",
      appSecret: "test_secret",
      apiVersion: "v21.0",
      webhookBaseUrl: "https://switchboard.example.com",
      graphApiFetch: mockGraphApi,
      createConnection: mockCreateConnection,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    mockGraphApi.mockReset();
    mockCreateConnection.mockReset();
  });

  it("should complete onboarding with valid ES token", async () => {
    // debug_token
    mockGraphApi.mockResolvedValueOnce({
      data: {
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: ["waba_123"] },
          { scope: "whatsapp_business_messaging", target_ids: ["waba_123"] },
        ],
      },
    });
    // assigned_users
    mockGraphApi.mockResolvedValueOnce({ success: true });
    // phone_numbers
    mockGraphApi.mockResolvedValueOnce({
      data: [{ id: "phone_456", verified_name: "Test Biz", display_phone_number: "+1555123" }],
    });
    // register phone
    mockGraphApi.mockResolvedValueOnce({ success: true });
    // subscribed_apps
    mockGraphApi.mockResolvedValueOnce({ success: true });
    // business profile
    mockGraphApi.mockResolvedValueOnce({ success: true });
    // createConnection
    mockCreateConnection.mockResolvedValueOnce({
      id: "conn_1",
      webhookPath: "/webhook/managed/conn_1",
    });

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "short_lived_token_123" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.wabaId).toBe("waba_123");
    expect(body.phoneNumberId).toBe("phone_456");
    expect(body.connectionId).toBe("conn_1");

    // Verify Graph API call order
    expect(mockGraphApi).toHaveBeenCalledTimes(6);
    // debug_token
    expect(mockGraphApi.mock.calls[0]![0]).toContain("debug_token");
    // assigned_users
    expect(mockGraphApi.mock.calls[1]![0]).toContain("assigned_users");
    // phone_numbers
    expect(mockGraphApi.mock.calls[2]![0]).toContain("phone_numbers");
    // register
    expect(mockGraphApi.mock.calls[3]![0]).toContain("register");
    // subscribed_apps with override_callback_uri
    expect(mockGraphApi.mock.calls[4]![0]).toContain("subscribed_apps");
    // business profile
    expect(mockGraphApi.mock.calls[5]![0]).toContain("whatsapp_business_profile");
  });

  it("should return 400 for missing token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("should return 502 when debug_token fails", async () => {
    mockGraphApi.mockRejectedValueOnce(new Error("Network error"));

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "bad_token" },
    });

    expect(response.statusCode).toBe(502);
  });

  it("should return 400 when no WABA found in scopes", async () => {
    mockGraphApi.mockResolvedValueOnce({
      data: {
        granular_scopes: [{ scope: "business_management", target_ids: [] }],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "token_no_waba" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("No WABA");
  });
});

describe("WhatsApp onboarding ESU integration (helper-extracted path)", () => {
  // Regression net for the Meta-helper extraction (Tasks 3+) and the
  // apiVersion plumbing landed in commit b39a22bc. Drives the full ESU route
  // through Fastify inject() with a captured graphApiFetch and asserts that:
  //   - /debug_token is reached via fetchWabaIdFromToken
  //   - /<waba>/subscribed_apps is reached via registerWebhookOverride
  //   - the configured apiVersion ("v17.0", deliberately ≠ prod "v21.0")
  //     flows through every Meta URL
  //   - createConnection receives the ESU-extracted WABA + phone fields
  let app: FastifyInstance;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  const graphApiFetch = vi.fn(async (url: string, init?: RequestInit) => {
    captured.push({ url, init });
    if (url.includes("/debug_token")) {
      return {
        data: {
          granular_scopes: [
            {
              scope: "whatsapp_business_management",
              target_ids: ["WABA_ESU_999"],
            },
            {
              scope: "whatsapp_business_messaging",
              target_ids: ["WABA_ESU_999"],
            },
          ],
        },
      };
    }
    if (url.includes("/phone_numbers")) {
      return {
        data: [
          {
            id: "PHONE_ESU_888",
            verified_name: "ESU Test Biz",
            display_phone_number: "+15555550100",
          },
        ],
      };
    }
    return { success: true };
  });
  const createConnection = vi.fn(async () => ({
    id: "conn_esu_42",
    webhookPath: "/webhook/managed/conn_esu_42",
  }));

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(whatsappOnboardingRoutes, {
      metaSystemUserToken: "SYSTEM_TOKEN_FAKE",
      metaSystemUserId: "SYSTEM_USER_FAKE",
      appSecret: "APP_SECRET_FAKE",
      apiVersion: "v17.0",
      webhookBaseUrl: "https://chat.example.com",
      graphApiFetch,
      createConnection,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("drives the full ESU route through helpers with apiVersion plumbed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "ESU_SHORT_LIVED_TOKEN" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.wabaId).toBe("WABA_ESU_999");
    expect(body.phoneNumberId).toBe("PHONE_ESU_888");
    expect(body.connectionId).toBe("conn_esu_42");

    // Six Meta calls are expected (debug_token, assigned_users, phone_numbers,
    // register, subscribed_apps, whatsapp_business_profile).
    expect(captured.length).toBe(6);

    // apiVersion plumbing: every URL must contain the configured /v17.0/ prefix
    // (≠ the production hardcode of v21.0). Regression net for b39a22bc.
    for (const call of captured) {
      expect(call.url).toContain("/v17.0/");
      expect(call.url).not.toContain("/v21.0/");
    }

    // /debug_token: query-param auth (NO Bearer header), per the locked
    // token-model contract in lib/whatsapp-meta.ts.
    const debugCall = captured.find((c) => c.url.includes("/debug_token"));
    expect(debugCall).toBeDefined();
    expect(debugCall!.url).toContain("input_token=ESU_SHORT_LIVED_TOKEN");
    expect(debugCall!.url).toContain("access_token=SYSTEM_TOKEN_FAKE");

    // /subscribed_apps: must use Bearer SYSTEM_TOKEN_FAKE (ESU adds the system
    // user to the customer WABA, so the system token is the credential with
    // access — preserve, don't redline) and carry override_callback_uri +
    // verify_token in the JSON body.
    const subscribedCall = captured.find((c) => c.url.includes("/subscribed_apps"));
    expect(subscribedCall).toBeDefined();
    expect(subscribedCall!.url).toContain("/WABA_ESU_999/subscribed_apps");
    const headers = subscribedCall!.init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer SYSTEM_TOKEN_FAKE");
    const subBody = JSON.parse(subscribedCall!.init?.body as string);
    expect(subBody.override_callback_uri).toBe(
      "https://chat.example.com/webhook/managed/conn_esu_42",
    );
    expect(subBody.verify_token).toBe("APP_SECRET_FAKE");

    // createConnection receives the ESU-extracted fields.
    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(createConnection).toHaveBeenCalledWith({
      wabaId: "WABA_ESU_999",
      phoneNumberId: "PHONE_ESU_888",
      verifiedName: "ESU Test Biz",
      displayPhoneNumber: "+15555550100",
    });
  });
});

describe("WhatsApp onboarding ESU chat-registration (Task 8.5)", () => {
  // Drives the new provision-notify wiring through Fastify inject() with a
  // captured notifyFetch so we can assert: chatRegistration semantics, that
  // notify happens iff env is configured, and that the connection.id from
  // createConnection is the payload.

  function makeGraphApiFetch() {
    return vi.fn(async (url: string) => {
      if (url.includes("/debug_token")) {
        return {
          data: {
            granular_scopes: [
              {
                scope: "whatsapp_business_management",
                target_ids: ["WABA_NOTIFY_1"],
              },
            ],
          },
        };
      }
      if (url.includes("/phone_numbers")) {
        return {
          data: [
            {
              id: "PHONE_NOTIFY_1",
              verified_name: "Notify Biz",
              display_phone_number: "+15555550100",
            },
          ],
        };
      }
      return { success: true };
    });
  }

  it("returns chatRegistration=active when notify succeeds; calls /internal/provision-notify once", async () => {
    const notifyCalls: Array<{ url: string; init?: RequestInit }> = [];
    const notifyFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      notifyCalls.push({ url: typeof url === "string" ? url : url.toString(), init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const app = Fastify({ logger: false });
    await app.register(whatsappOnboardingRoutes, {
      metaSystemUserToken: "TKN",
      metaSystemUserId: "SYS",
      appSecret: "APPSEC",
      apiVersion: "v17.0",
      webhookBaseUrl: "https://chat.example.com",
      chatPublicUrl: "https://chat.example.com",
      internalApiSecret: "internal-secret",
      notifyFetch,
      graphApiFetch: makeGraphApiFetch(),
      createConnection: async () => ({
        id: "conn_notify_1",
        webhookPath: "/webhook/managed/conn_notify_1",
      }),
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "ESU_TOKEN" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.chatRegistration).toBe("active");
    expect(body.chatRegistrationDetail).toBeNull();

    const notifyHits = notifyCalls.filter((c) => c.url.includes("/internal/provision-notify"));
    expect(notifyHits).toHaveLength(1);
    expect(notifyHits[0]!.url).toBe("https://chat.example.com/internal/provision-notify");
    const headers = notifyHits[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer internal-secret");
    const reqBody = JSON.parse(notifyHits[0]!.init!.body as string);
    expect(reqBody).toEqual({ managedChannelId: "conn_notify_1" });

    await app.close();
  });

  it("returns chatRegistration=pending_chat_register when notify fails twice; success stays true", async () => {
    const notifyCalls: Array<{ url: string; init?: RequestInit }> = [];
    const notifyFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      notifyCalls.push({ url: typeof url === "string" ? url : url.toString(), init });
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    const app = Fastify({ logger: false });
    await app.register(whatsappOnboardingRoutes, {
      metaSystemUserToken: "TKN",
      metaSystemUserId: "SYS",
      appSecret: "APPSEC",
      apiVersion: "v17.0",
      webhookBaseUrl: "https://chat.example.com",
      chatPublicUrl: "https://chat.example.com",
      internalApiSecret: "internal-secret",
      notifyFetch,
      graphApiFetch: makeGraphApiFetch(),
      createConnection: async () => ({
        id: "conn_notify_2",
        webhookPath: "/webhook/managed/conn_notify_2",
      }),
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "ESU_TOKEN" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Backward compatibility — `success` stays true even when notify fails.
    // The new `chatRegistration` field is the truthy signal.
    expect(body.success).toBe(true);
    expect(body.chatRegistration).toBe("pending_chat_register");
    expect(body.chatRegistrationDetail).toBeTruthy();
    expect(body.chatRegistrationDetail).toMatch(/Provision-notify failed after retry/);

    const notifyHits = notifyCalls.filter((c) => c.url.includes("/internal/provision-notify"));
    expect(notifyHits).toHaveLength(2);

    await app.close();
  });

  it("returns chatRegistration=config_error when chat env is missing; no /internal/provision-notify fetch", async () => {
    const notifyCalls: Array<{ url: string; init?: RequestInit }> = [];
    const notifyFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      notifyCalls.push({ url: typeof url === "string" ? url : url.toString(), init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const app = Fastify({ logger: false });
    await app.register(whatsappOnboardingRoutes, {
      metaSystemUserToken: "TKN",
      metaSystemUserId: "SYS",
      appSecret: "APPSEC",
      apiVersion: "v17.0",
      webhookBaseUrl: "https://chat.example.com",
      // chatPublicUrl + internalApiSecret intentionally omitted
      notifyFetch,
      graphApiFetch: makeGraphApiFetch(),
      createConnection: async () => ({
        id: "conn_notify_3",
        webhookPath: "/webhook/managed/conn_notify_3",
      }),
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "ESU_TOKEN" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.chatRegistration).toBe("config_error");
    expect(body.chatRegistrationDetail).toMatch(/CHAT_PUBLIC_URL/);
    expect(body.chatRegistrationDetail).toMatch(/INTERNAL_API_SECRET/);

    const notifyHits = notifyCalls.filter((c) => c.url.includes("/internal/provision-notify"));
    expect(notifyHits).toHaveLength(0);

    await app.close();
  });
});
