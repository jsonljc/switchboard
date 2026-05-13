import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappManagementRoutes } from "../whatsapp-management.js";

describe("WhatsApp management routes", () => {
  let app: FastifyInstance;
  const mockGraphFetch = vi.fn();
  const mockFindFirst = vi.fn();

  // Set encryption key for tests
  process.env.CREDENTIALS_ENCRYPTION_KEY = "test-key-for-whatsapp-management-tests-32chars";

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Decorate with mock Prisma
    app.decorate("prisma", {
      connection: {
        findFirst: mockFindFirst,
      },
    } as any);

    // Decorate request with organizationIdFromAuth
    app.decorateRequest("organizationIdFromAuth", "");
    app.addHook("onRequest", async (request) => {
      (request as any).organizationIdFromAuth = "org_test";
    });

    await app.register(whatsappManagementRoutes, {
      graphApiFetch: mockGraphFetch as any,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockGraphFetch.mockReset();
    mockFindFirst.mockReset();
  });

  describe("GET /account", () => {
    it("returns 404 when no connection exists", async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe("WHATSAPP_NOT_CONNECTED");
    });

    it("returns 409 when connection exists but no externalAccountId", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: null,
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.error).toBe("WHATSAPP_CONNECTION_INCOMPLETE");
      expect(body.message).toContain("WABA ID");
    });

    it("returns 409 when connection exists but no primaryPhoneNumberId in credentials", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({}),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.error).toBe("WHATSAPP_CONNECTION_INCOMPLETE");
      expect(body.message).toContain("primary phone number ID");
    });

    it("returns needs_attention when WABA Graph fails with permission error", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { code: 10, message: "Permission denied" } }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.readiness).toBe("needs_attention");
      expect(body.reasons).toHaveLength(1);
      expect(body.reasons[0].message).toContain("Cannot access WABA");
    });

    it("returns needs_attention when WABA succeeds but phone_numbers Graph fails", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      // WABA call succeeds
      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          timezone_id: "America/Los_Angeles",
          message_template_namespace: "ns_123",
          account_review_status: "APPROVED",
        }),
      });

      // Phone numbers call fails
      mockGraphFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal error" } }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.readiness).toBe("needs_attention");
      expect(body.reasons).toHaveLength(1);
      expect(body.reasons[0].message).toContain("Cannot read phone numbers");
      expect(body.account.name).toBe("Test Business");
    });

    it("returns needs_attention when WABA review status is PENDING", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          timezone_id: "America/Los_Angeles",
          message_template_namespace: "ns_123",
          account_review_status: "PENDING",
        }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "phone_123",
              display_phone_number: "+15551234567",
              verified_name: "Test",
              code_verification_status: "CONNECTED",
              quality_rating: "GREEN",
              messaging_limit_tier: "TIER_1K",
            },
          ],
        }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.readiness).toBe("needs_attention");
      expect(body.reasons.some((r: any) => r.step === "waba_review")).toBe(true);
      expect(body.reasons.some((r: any) => r.message.includes("PENDING"))).toBe(true);
    });

    it("returns needs_attention when primary phone quality is RED", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          timezone_id: "America/Los_Angeles",
          message_template_namespace: "ns_123",
          account_review_status: "APPROVED",
        }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "phone_123",
              display_phone_number: "+15551234567",
              verified_name: "Test",
              code_verification_status: "CONNECTED",
              quality_rating: "RED",
              messaging_limit_tier: "TIER_1K",
            },
          ],
        }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.readiness).toBe("needs_attention");
      expect(body.reasons.some((r: any) => r.message.includes("quality is low"))).toBe(true);
    });

    it("returns needs_attention when primary phone is missing from Graph response", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_999" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          timezone_id: "America/Los_Angeles",
          message_template_namespace: "ns_123",
          account_review_status: "APPROVED",
        }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "phone_123",
              display_phone_number: "+15551234567",
              verified_name: "Test",
              code_verification_status: "CONNECTED",
              quality_rating: "GREEN",
              messaging_limit_tier: "TIER_1K",
            },
          ],
        }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.readiness).toBe("needs_attention");
      expect(body.reasons.some((r: any) => r.message.includes("not found"))).toBe(true);
    });

    it("returns needs_attention when primary phone status is not CONNECTED", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          timezone_id: "America/Los_Angeles",
          message_template_namespace: "ns_123",
          account_review_status: "APPROVED",
        }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "phone_123",
              display_phone_number: "+15551234567",
              verified_name: "Test",
              code_verification_status: "PENDING",
              quality_rating: "GREEN",
              messaging_limit_tier: "TIER_1K",
            },
          ],
        }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.readiness).toBe("needs_attention");
      expect(body.reasons.some((r: any) => r.message.includes("PENDING"))).toBe(true);
    });

    it("returns ready when all checks pass", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          timezone_id: "America/Los_Angeles",
          message_template_namespace: "ns_123",
          account_review_status: "APPROVED",
        }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "phone_123",
              display_phone_number: "+15551234567",
              verified_name: "Test",
              code_verification_status: "CONNECTED",
              quality_rating: "GREEN",
              messaging_limit_tier: "TIER_1K",
            },
          ],
        }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.readiness).toBe("ready");
      expect(body.reasons).toHaveLength(0);
      expect(body.account.name).toBe("Test Business");
      expect(body.connection.wabaId).toBe("waba_123");
    });

    it("handles unknown Graph enum values without crashing", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          timezone_id: "America/Los_Angeles",
          message_template_namespace: "ns_123",
          account_review_status: "FUTURE_STATUS_NOT_YET_KNOWN",
        }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "phone_123",
              display_phone_number: "+15551234567",
              verified_name: "Test",
              code_verification_status: "CONNECTED",
              quality_rating: "UNKNOWN_RATING",
              messaging_limit_tier: "TIER_1K",
            },
          ],
        }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.account.reviewStatus).toBe("FUTURE_STATUS_NOT_YET_KNOWN");
    });
  });

  describe("GET /phone-numbers", () => {
    it("returns phone numbers with qualityBadge and isPrimaryForSwitchboard", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "phone_123",
              display_phone_number: "+15551234567",
              verified_name: "Primary Phone",
              code_verification_status: "CONNECTED",
              quality_rating: "GREEN",
              messaging_limit_tier: "TIER_1K",
            },
            {
              id: "phone_456",
              display_phone_number: "+15559999999",
              verified_name: "Secondary Phone",
              code_verification_status: "CONNECTED",
              quality_rating: "YELLOW",
              messaging_limit_tier: "TIER_100",
            },
          ],
        }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/phone-numbers",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.phoneNumbers).toHaveLength(2);

      const primary = body.phoneNumbers.find((p: any) => p.id === "phone_123");
      expect(primary.isPrimaryForSwitchboard).toBe(true);
      expect(primary.qualityBadge).toBe("good");

      const secondary = body.phoneNumbers.find((p: any) => p.id === "phone_456");
      expect(secondary.isPrimaryForSwitchboard).toBe(false);
      expect(secondary.qualityBadge).toBe("warning");
    });
  });

  describe("GET /templates", () => {
    it("returns templates with hasBody and hasButtons derived from components", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "tmpl_1",
              name: "welcome",
              language: "en",
              status: "APPROVED",
              category: "MARKETING",
              components: [
                { type: "HEADER" },
                { type: "BODY", text: "Welcome {{1}}!" },
                { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "OK" }] },
              ],
            },
            {
              id: "tmpl_2",
              name: "simple",
              language: "en",
              status: "APPROVED",
              category: "UTILITY",
              components: [{ type: "BODY", text: "Simple message" }],
            },
            {
              id: "tmpl_3",
              name: "header_only",
              language: "en",
              status: "APPROVED",
              category: "UTILITY",
              components: [{ type: "HEADER" }],
            },
          ],
        }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/templates",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.templates).toHaveLength(3);

      const welcome = body.templates.find((t: any) => t.name === "welcome");
      expect(welcome.hasBody).toBe(true);
      expect(welcome.hasButtons).toBe(true);

      const simple = body.templates.find((t: any) => t.name === "simple");
      expect(simple.hasBody).toBe(true);
      expect(simple.hasButtons).toBe(false);

      const headerOnly = body.templates.find((t: any) => t.name === "header_only");
      expect(headerOnly.hasBody).toBe(false);
      expect(headerOnly.hasButtons).toBe(false);
    });
  });
});
