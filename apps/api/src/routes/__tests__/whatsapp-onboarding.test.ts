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
