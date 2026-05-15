import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappSendTestRoutes } from "../whatsapp-send-test.js";

function buildPrismaMock() {
  return {
    connection: { findFirst: vi.fn() },
    managedChannel: { findFirst: vi.fn() },
    whatsAppTestSend: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

async function buildApp(opts: {
  prisma: ReturnType<typeof buildPrismaMock>;
  graphApiFetch: typeof fetch;
}) {
  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- existing house style in whatsapp-management.test.ts
  app.decorate("prisma", opts.prisma as any);
  app.decorateRequest("organizationIdFromAuth", "");
  app.decorateRequest("principalIdFromAuth", "");
  app.addHook("onRequest", async (request) => {
    (request as unknown as { organizationIdFromAuth: string }).organizationIdFromAuth = "org_test";
    (request as unknown as { principalIdFromAuth: string }).principalIdFromAuth = "u@example.com";
  });
  await app.register(whatsappSendTestRoutes, { graphApiFetch: opts.graphApiFetch });
  return app;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("whatsappSendTestRoutes registration", () => {
  let app: FastifyInstance;
  beforeEach(() => {});
  it("registers POST /send-test and GET /test-sends", async () => {
    app = await buildApp({ prisma: buildPrismaMock(), graphApiFetch: vi.fn() });
    expect(app.hasRoute({ method: "POST", url: "/send-test" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/test-sends" })).toBe(true);
    await app.close();
  });
});

describe("POST /send-test", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.stubEnv("META_SYSTEM_USER_TOKEN", "TOKEN");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (app) await app.close();
  });

  it("6a — happy path: fetches templates, posts to Graph, persists row, returns messageId", async () => {
    const prisma = buildPrismaMock();
    prisma.managedChannel.findFirst.mockResolvedValue({
      id: "ch_1",
      connectionId: "conn_1",
      testRecipients: ["+15551234567"],
    });
    prisma.connection.findFirst.mockResolvedValue({
      id: "conn_1",
      externalAccountId: "WABA_1",
    });
    prisma.whatsAppTestSend.create.mockResolvedValue({});

    const graphApiFetch = vi
      .fn()
      .mockImplementationOnce(async () =>
        jsonResponse({
          data: [
            {
              id: "t1",
              name: "appt_reminder",
              language: "en_US",
              status: "APPROVED",
              category: "UTILITY",
              components: [{ type: "BODY" }],
            },
          ],
        }),
      )
      .mockImplementationOnce(async () => jsonResponse({ messages: [{ id: "wamid.HBgLABC==" }] }));

    app = await buildApp({ prisma, graphApiFetch });

    const res = await app.inject({
      method: "POST",
      url: "/send-test",
      payload: {
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { messageId: string; status: string; sentAt: string };
    expect(body.messageId).toBe("wamid.HBgLABC==");
    expect(body.status).toBe("sent");
    expect(typeof body.sentAt).toBe("string");
    expect(new Date(body.sentAt).toISOString()).toBe(body.sentAt);

    // whatsAppTestSend.create called exactly once with matching fields
    expect(prisma.whatsAppTestSend.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.whatsAppTestSend.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data).toMatchObject({
      organizationId: "org_test",
      managedChannelId: "ch_1",
      messageId: "wamid.HBgLABC==",
      phoneNumberId: "PN_123",
      templateName: "appt_reminder",
      languageCode: "en_US",
      toNumber: "+15551234567",
      sentBy: "u@example.com",
      apiStatus: "sent",
    });

    // Both Graph calls authorized with Bearer TOKEN
    expect(graphApiFetch).toHaveBeenCalledTimes(2);
    const firstCall = graphApiFetch.mock.calls[0]!;
    const secondCall = graphApiFetch.mock.calls[1]!;
    const firstUrl = firstCall[0] as string;
    const secondUrl = secondCall[0] as string;
    const firstInit = firstCall[1] as RequestInit;
    const secondInit = secondCall[1] as RequestInit;
    expect((firstInit.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect((secondInit.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(firstUrl).toContain("/WABA_1/message_templates");
    expect(secondUrl).toContain("/PN_123/messages");
  });

  it("6b — recipient not on allowlist returns 403 and does NOT call Graph", async () => {
    const prisma = buildPrismaMock();
    prisma.managedChannel.findFirst.mockResolvedValue({
      id: "ch_1",
      connectionId: "conn_1",
      testRecipients: ["+15550000000"],
    });
    const graphApiFetch = vi.fn();
    app = await buildApp({ prisma, graphApiFetch });

    const res = await app.inject({
      method: "POST",
      url: "/send-test",
      payload: {
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("WHATSAPP_RECIPIENT_NOT_ALLOWLISTED");
    expect(graphApiFetch).not.toHaveBeenCalled();
    expect(prisma.whatsAppTestSend.create).not.toHaveBeenCalled();
  });

  it("6c — template not APPROVED returns 400 and does NOT call /messages", async () => {
    const prisma = buildPrismaMock();
    prisma.managedChannel.findFirst.mockResolvedValue({
      id: "ch_1",
      connectionId: "conn_1",
      testRecipients: ["+15551234567"],
    });
    prisma.connection.findFirst.mockResolvedValue({
      id: "conn_1",
      externalAccountId: "WABA_1",
    });

    const graphApiFetch = vi.fn().mockImplementationOnce(async () =>
      jsonResponse({
        data: [
          {
            id: "t1",
            name: "appt_reminder",
            language: "en_US",
            status: "PENDING",
            category: "UTILITY",
            components: [{ type: "BODY" }],
          },
        ],
      }),
    );

    app = await buildApp({ prisma, graphApiFetch });

    const res = await app.inject({
      method: "POST",
      url: "/send-test",
      payload: {
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("WHATSAPP_TEMPLATE_NOT_APPROVED");
    expect(graphApiFetch).toHaveBeenCalledTimes(1);
    const onlyUrl = graphApiFetch.mock.calls[0]![0] as string;
    expect(onlyUrl).toContain("/WABA_1/message_templates");
    expect(prisma.whatsAppTestSend.create).not.toHaveBeenCalled();
  });

  it("filters managedChannel.findFirst by status active|provisioning (disabled channels return 404)", async () => {
    const prisma = buildPrismaMock();
    prisma.managedChannel.findFirst.mockResolvedValue(null);
    const graphApiFetch = vi.fn();

    app = await buildApp({ prisma, graphApiFetch });

    const res = await app.inject({
      method: "POST",
      url: "/send-test",
      payload: {
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
      },
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("WHATSAPP_NOT_CONNECTED");
    expect(prisma.managedChannel.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org_test",
        channel: "whatsapp",
        status: { in: ["active", "provisioning"] },
      },
    });
    expect(graphApiFetch).not.toHaveBeenCalled();
  });
});

describe("POST /send-test — Graph error mapping", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.stubEnv("META_SYSTEM_USER_TOKEN", "TOKEN");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (app) await app.close();
  });

  function approvedTemplatesResponse(): Response {
    return jsonResponse({
      data: [
        {
          id: "t1",
          name: "appt_reminder",
          language: "en_US",
          status: "APPROVED",
          category: "UTILITY",
          components: [{ type: "BODY" }],
        },
      ],
    });
  }

  it("maps Graph 429 rate-limit response to 429 WHATSAPP_RATE_LIMITED (retryable)", async () => {
    const prisma = buildPrismaMock();
    prisma.managedChannel.findFirst.mockResolvedValue({
      id: "ch_1",
      connectionId: "conn_1",
      testRecipients: ["+15551234567"],
    });
    prisma.connection.findFirst.mockResolvedValue({
      id: "conn_1",
      externalAccountId: "WABA_1",
    });

    const graphApiFetch = vi
      .fn()
      .mockImplementationOnce(async () => approvedTemplatesResponse())
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ error: { code: 4, message: "rate" } }), {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
      );

    app = await buildApp({ prisma, graphApiFetch });

    const res = await app.inject({
      method: "POST",
      url: "/send-test",
      payload: {
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
      },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json() as { error: { code: string; retryable: boolean } };
    expect(body.error.code).toBe("WHATSAPP_RATE_LIMITED");
    expect(body.error.retryable).toBe(true);

    // Precheck (templates) call happened first
    expect(graphApiFetch).toHaveBeenCalledTimes(2);
    const firstUrl = graphApiFetch.mock.calls[0]![0] as string;
    expect(firstUrl).toContain("/WABA_1/message_templates");

    expect(prisma.whatsAppTestSend.create).not.toHaveBeenCalled();
  });

  it("maps Graph 200 without message id to 502 WHATSAPP_NO_MESSAGE_ID (retryable)", async () => {
    const prisma = buildPrismaMock();
    prisma.managedChannel.findFirst.mockResolvedValue({
      id: "ch_1",
      connectionId: "conn_1",
      testRecipients: ["+15551234567"],
    });
    prisma.connection.findFirst.mockResolvedValue({
      id: "conn_1",
      externalAccountId: "WABA_1",
    });

    const graphApiFetch = vi
      .fn()
      .mockImplementationOnce(async () => approvedTemplatesResponse())
      .mockImplementationOnce(async () => jsonResponse({ messages: [] }));

    app = await buildApp({ prisma, graphApiFetch });

    const res = await app.inject({
      method: "POST",
      url: "/send-test",
      payload: {
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
      },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json() as { error: { code: string; retryable: boolean } };
    expect(body.error.code).toBe("WHATSAPP_NO_MESSAGE_ID");
    expect(body.error.retryable).toBe(true);

    // Precheck (templates) call happened first
    expect(graphApiFetch).toHaveBeenCalledTimes(2);
    const firstUrl = graphApiFetch.mock.calls[0]![0] as string;
    expect(firstUrl).toContain("/WABA_1/message_templates");

    expect(prisma.whatsAppTestSend.create).not.toHaveBeenCalled();
  });
});

describe("GET /test-sends", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns recent test sends scoped to the org with ISO-serialized dates", async () => {
    const prisma = buildPrismaMock();
    prisma.whatsAppTestSend.findMany.mockResolvedValue([
      {
        id: "ts_1",
        messageId: "wamid.AAA",
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
        sentBy: "u@example.com",
        sentAt: new Date("2026-05-14T10:00:00.000Z"),
        apiStatus: "sent",
        lastWebhookStatus: "delivered",
        lastWebhookAt: new Date("2026-05-14T10:00:05.000Z"),
      },
    ]);

    app = await buildApp({ prisma, graphApiFetch: vi.fn() });

    const res = await app.inject({ method: "GET", url: "/test-sends" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tests: Array<{
        id: string;
        messageId: string;
        phoneNumberId: string;
        templateName: string;
        languageCode: string;
        toNumber: string;
        sentBy: string;
        sentAt: string;
        apiStatus: string;
        lastWebhookStatus: string | null;
        lastWebhookAt: string | null;
      }>;
    };
    expect(body.tests).toHaveLength(1);
    expect(body.tests[0]).toEqual({
      id: "ts_1",
      messageId: "wamid.AAA",
      phoneNumberId: "PN_123",
      templateName: "appt_reminder",
      languageCode: "en_US",
      toNumber: "+15551234567",
      sentBy: "u@example.com",
      sentAt: "2026-05-14T10:00:00.000Z",
      apiStatus: "sent",
      lastWebhookStatus: "delivered",
      lastWebhookAt: "2026-05-14T10:00:05.000Z",
    });

    expect(prisma.whatsAppTestSend.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppTestSend.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_test" },
      orderBy: { sentAt: "desc" },
      take: 10,
    });
  });

  it("preserves lastWebhookAt: null without crashing", async () => {
    const prisma = buildPrismaMock();
    prisma.whatsAppTestSend.findMany.mockResolvedValue([
      {
        id: "ts_2",
        messageId: "wamid.BBB",
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
        sentBy: "u@example.com",
        sentAt: new Date("2026-05-14T11:00:00.000Z"),
        apiStatus: "sent",
        lastWebhookStatus: null,
        lastWebhookAt: null,
      },
    ]);

    app = await buildApp({ prisma, graphApiFetch: vi.fn() });

    const res = await app.inject({ method: "GET", url: "/test-sends" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tests: Array<{ lastWebhookAt: string | null; lastWebhookStatus: string | null }>;
    };
    expect(body.tests).toHaveLength(1);
    expect(body.tests[0]!.lastWebhookAt).toBeNull();
    expect(body.tests[0]!.lastWebhookStatus).toBeNull();
  });
});

describe("auth guards", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function buildAppWithoutAuth(prisma: ReturnType<typeof buildPrismaMock>) {
    const a = Fastify({ logger: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- existing house style
    a.decorate("prisma", prisma as any);
    a.decorateRequest("organizationIdFromAuth", "");
    a.decorateRequest("principalIdFromAuth", "");
    await a.register(whatsappSendTestRoutes, { graphApiFetch: vi.fn() });
    return a;
  }

  it("POST /send-test returns 401 when organizationIdFromAuth is missing", async () => {
    const prisma = buildPrismaMock();
    app = await buildAppWithoutAuth(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/send-test",
      payload: {
        phoneNumberId: "PN_123",
        templateName: "appt_reminder",
        languageCode: "en_US",
        toNumber: "+15551234567",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication required", retryable: false },
    });
    expect(prisma.managedChannel.findFirst).not.toHaveBeenCalled();
  });

  it("GET /test-sends returns 401 when organizationIdFromAuth is missing", async () => {
    const prisma = buildPrismaMock();
    app = await buildAppWithoutAuth(prisma);
    const res = await app.inject({ method: "GET", url: "/test-sends" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication required", retryable: false },
    });
    expect(prisma.whatsAppTestSend.findMany).not.toHaveBeenCalled();
  });
});
