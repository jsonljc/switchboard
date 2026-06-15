import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappOnboardingRoutes } from "../whatsapp-onboarding.js";

// Lives in its own file (not whatsapp-onboarding.test.ts) because that file is
// already at the eslint max-lines ceiling; new onboarding test aspects get a
// sibling file rather than growing the shared one.
describe("WhatsApp onboarding assigned_users tasks encoding", () => {
  let app: FastifyInstance;
  const capturedUrls: string[] = [];
  const graphApiFetch = vi.fn(async (url: string) => {
    capturedUrls.push(url);
    if (url.includes("/debug_token")) {
      return {
        data: {
          granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA"] }],
        },
      };
    }
    if (url.includes("/phone_numbers")) {
      return { data: [{ id: "PH", verified_name: "Biz", display_phone_number: "+15550000" }] };
    }
    return { success: true };
  });

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.decorate("authDisabled", true);
    await app.register(whatsappOnboardingRoutes, {
      metaSystemUserToken: "suat_test",
      metaSystemUserId: "sys_user_123",
      appSecret: "test_secret",
      apiVersion: "v21.0",
      webhookBaseUrl: "https://switchboard.example.com",
      graphApiFetch,
      createConnection: async () => ({ id: "conn_enc", webhookPath: "/webhook/managed/conn_enc" }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends assigned_users tasks as a URL-encoded JSON array, not a single-quote literal", async () => {
    capturedUrls.length = 0;

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "T", organizationId: "org_test" },
    });

    expect(response.statusCode).toBe(200);

    const assignedUsersUrl = capturedUrls.find((u) => u.includes("assigned_users"));
    expect(assignedUsersUrl).toBeDefined();

    // tasks must be a URL-encoded JSON array: %5B%22MANAGE%22%5D
    const encoded = encodeURIComponent(JSON.stringify(["MANAGE"]));
    expect(assignedUsersUrl).toContain(encoded);

    // must NOT contain the invalid single-quote literal
    expect(assignedUsersUrl).not.toContain("['MANAGE']");
  });
});
