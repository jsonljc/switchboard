/* eslint-disable max-lines -- aggregated route tests: 18 cases across
   /account, /phone-numbers, and /templates branches share one Fastify
   harness and Prisma mock. Splitting requires three sibling files plus a
   shared test-utils module; tracked as a follow-up. */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappManagementRoutes } from "../whatsapp-management.js";

describe("WhatsApp management routes", () => {
  let app: FastifyInstance;
  const mockGraphFetch = vi.fn();
  const mockFindFirst = vi.fn();
  const mockManagedChannelFindFirst = vi.fn();

  // Set encryption key for tests
  process.env.CREDENTIALS_ENCRYPTION_KEY = "test-key-for-whatsapp-management-tests-32chars";

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Decorate with mock Prisma
    app.decorate("prisma", {
      connection: {
        findFirst: mockFindFirst,
      },
      managedChannel: {
        findFirst: mockManagedChannelFindFirst,
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
    mockManagedChannelFindFirst.mockReset();
    // Default to empty allowlist so every existing test still passes.
    mockManagedChannelFindFirst.mockResolvedValue({ testRecipients: [] });
  });

  describe("GET /account", () => {
    it("returns not_connected when no connection exists", async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "GET",
        url: "/account",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.connection.status).toBe("not_connected");
      expect(body.readiness.status).toBe("not_connected");
      expect(body.readiness.reasons).toHaveLength(1);
    });

    it("returns incomplete when connection exists but no externalAccountId", async () => {
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

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.connection.status).toBe("incomplete");
      expect(body.readiness.status).toBe("incomplete");
      expect(body.readiness.reasons.some((r: string) => r.includes("WABA ID"))).toBe(true);
    });

    it("returns incomplete when connection exists but no primaryPhoneNumberId in credentials", async () => {
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

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.connection.status).toBe("incomplete");
      expect(body.readiness.status).toBe("incomplete");
      expect(
        body.readiness.reasons.some((r: string) => r.includes("primary phone number ID")),
      ).toBe(true);
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
      expect(body.readiness.status).toBe("needs_attention");
      expect(body.readiness.reasons).toHaveLength(1);
      expect(body.readiness.reasons[0]).toContain("Cannot access WABA");
    });

    it("accumulates phone failure reason and still checks WABA review when phone_numbers Graph fails", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      // WABA call succeeds with PENDING review
      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          currency: "USD",
          timezone_id: "America/Los_Angeles",
          message_template_namespace: "ns_123",
          account_review_status: "PENDING",
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
      expect(body.readiness.status).toBe("needs_attention");
      // I4: both phone failure AND WABA review reasons should be accumulated
      expect(
        body.readiness.reasons.some((r: string) => r.includes("Cannot read phone numbers")),
      ).toBe(true);
      expect(body.readiness.reasons.some((r: string) => r.includes("PENDING"))).toBe(true);
      expect(body.account.name).toBe("Test Business");
      expect(body.account.currency).toBe("USD");
      expect(body.account.timezoneId).toBe("America/Los_Angeles");
      expect(body.account.templateNamespace).toBe("ns_123");
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
          currency: "USD",
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
              status: "CONNECTED",
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
      expect(body.readiness.status).toBe("needs_attention");
      expect(body.readiness.reasons.some((r: string) => r.includes("PENDING"))).toBe(true);
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
          currency: "USD",
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
              status: "CONNECTED",
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
      expect(body.readiness.status).toBe("needs_attention");
      expect(body.readiness.reasons.some((r: string) => r.includes("quality is low"))).toBe(true);
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
          currency: "USD",
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
              status: "CONNECTED",
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
      expect(body.readiness.status).toBe("needs_attention");
      expect(body.readiness.reasons.some((r: string) => r.includes("not found"))).toBe(true);
    });

    it("returns needs_attention when primary phone status is not CONNECTED (checks status field)", async () => {
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
          currency: "USD",
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
              status: "PENDING",
              code_verification_status: "VERIFIED",
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
      expect(body.readiness.status).toBe("needs_attention");
      expect(body.readiness.reasons.some((r: string) => r.includes("PENDING"))).toBe(true);
    });

    it("returns ready with correct response shape when all checks pass", async () => {
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
          currency: "USD",
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
              status: "CONNECTED",
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
      expect(body.readiness.status).toBe("ready");
      expect(body.readiness.reasons).toHaveLength(0);
      // C1: verify response shape matches frontend WhatsAppAccountData
      expect(body.connection.status).toBe("connected");
      expect(body.connection.externalAccountId).toBe("waba_123");
      expect(body.connection.primaryPhoneNumberId).toBe("phone_123");
      expect(body.account.name).toBe("Test Business");
      expect(body.account.currency).toBe("USD");
      expect(body.account.timezoneId).toBe("America/Los_Angeles");
      expect(body.account.templateNamespace).toBe("ns_123");
      expect(body.account.reviewStatus).toBe("APPROVED");
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
          currency: "USD",
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
              status: "CONNECTED",
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

    it("connected: includes testRecipients on the connection block", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });
      mockManagedChannelFindFirst.mockResolvedValueOnce({ testRecipients: ["+15551234567"] });
      mockGraphFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "waba_123",
          name: "Test Business",
          currency: "USD",
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
              status: "CONNECTED",
              quality_rating: "GREEN",
              messaging_limit_tier: "TIER_1K",
            },
          ],
        }),
      });

      const response = await app.inject({ method: "GET", url: "/account" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { connection: { testRecipients: string[] } };
      expect(body.connection.testRecipients).toEqual(["+15551234567"]);
    });

    it("not_connected: still surfaces empty testRecipients", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockManagedChannelFindFirst.mockResolvedValueOnce({ testRecipients: [] });

      const response = await app.inject({ method: "GET", url: "/account" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        connection: { status: string; testRecipients: string[] };
      };
      expect(body.connection.status).toBe("not_connected");
      expect(body.connection.testRecipients).toEqual([]);
    });

    it("incomplete: surfaces testRecipients alongside the incomplete status", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: null,
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });
      mockManagedChannelFindFirst.mockResolvedValueOnce({ testRecipients: ["+15551111111"] });

      const response = await app.inject({ method: "GET", url: "/account" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        connection: { status: string; testRecipients: string[] };
      };
      expect(body.connection.status).toBe("incomplete");
      expect(body.connection.testRecipients).toEqual(["+15551111111"]);
    });
  });

  describe("GET /phone-numbers", () => {
    it("returns phone numbers with all fields matching frontend type", async () => {
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
              code_verification_status: "VERIFIED",
              quality_rating: "GREEN",
              messaging_limit_tier: "TIER_1K",
              status: "CONNECTED",
              platform_type: "CLOUD_API",
              is_official_business_account: true,
            },
            {
              id: "phone_456",
              display_phone_number: "+15559999999",
              verified_name: "Secondary Phone",
              code_verification_status: "NOT_VERIFIED",
              quality_rating: "YELLOW",
              messaging_limit_tier: "TIER_100",
              status: "PENDING",
              platform_type: "CLOUD_API",
              is_official_business_account: false,
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
      // C3: messagingLimitTier not messagingLimit
      expect(primary.messagingLimitTier).toBe("TIER_1K");
      // C4: new fields from Graph API
      expect(primary.status).toBe("CONNECTED");
      expect(primary.platformType).toBe("CLOUD_API");
      expect(primary.codeVerificationStatus).toBe("VERIFIED");
      expect(primary.isOfficialBusinessAccount).toBe(true);

      const secondary = body.phoneNumbers.find((p: any) => p.id === "phone_456");
      expect(secondary.isPrimaryForSwitchboard).toBe(false);
      expect(secondary.qualityBadge).toBe("warning");
    });

    it("returns 403 for permission errors, not 502", async () => {
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
        url: "/phone-numbers",
      });

      // I5: 403 not blanket 502
      expect(response.statusCode).toBe(403);
      const body = response.json();
      // I1: error shape is { error: { code, message, retryable } }
      expect(body.error.code).toBe("WHATSAPP_GRAPH_PERMISSION_DENIED");
      expect(body.error.retryable).toBe(false);
    });

    it("returns 429 for rate limit errors", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "conn_1",
        organizationId: "org_test",
        serviceId: "whatsapp",
        externalAccountId: "waba_123",
        credentials: JSON.stringify({ primaryPhoneNumberId: "phone_123" }),
      });

      mockGraphFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: { code: 4, message: "Rate limited" } }),
      });

      const response = await app.inject({
        method: "GET",
        url: "/phone-numbers",
      });

      expect(response.statusCode).toBe(429);
      const body = response.json();
      expect(body.error.code).toBe("WHATSAPP_RATE_LIMITED");
      expect(body.error.retryable).toBe(true);
    });
  });

  describe("GET /templates", () => {
    it("returns templates with hasBody, hasButtons, rejectedReason and no components leak", async () => {
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
              rejected_reason: null,
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
              name: "rejected_one",
              language: "en",
              status: "REJECTED",
              category: "MARKETING",
              rejected_reason: "ABUSIVE_CONTENT",
              components: [{ type: "BODY", text: "Bad content" }],
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
      // I3: no components leak
      expect(welcome.components).toBeUndefined();
      // I2: rejectedReason present
      expect(welcome.rejectedReason).toBeNull();

      const simple = body.templates.find((t: any) => t.name === "simple");
      expect(simple.hasBody).toBe(true);
      expect(simple.hasButtons).toBe(false);

      const rejected = body.templates.find((t: any) => t.name === "rejected_one");
      expect(rejected.rejectedReason).toBe("ABUSIVE_CONTENT");
      expect(rejected.status).toBe("REJECTED");
    });
  });
});
