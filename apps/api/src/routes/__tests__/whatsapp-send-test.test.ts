import { describe, it, expect, vi, beforeEach } from "vitest";
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
  app.decorateRequest("userEmail", "");
  app.addHook("onRequest", async (request) => {
    (request as unknown as { organizationIdFromAuth: string }).organizationIdFromAuth = "org_test";
    (request as unknown as { userEmail: string }).userEmail = "u@example.com";
  });
  await app.register(whatsappSendTestRoutes, { graphApiFetch: opts.graphApiFetch });
  return app;
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
