import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { CalendarProvider } from "@switchboard/schemas";
import { metaDeletionRoutes } from "../routes/meta-deletion.js";
import type { CalendarProviderFactory } from "../bootstrap/calendar-provider-factory.js";

const APP_SECRET = "test-app-secret";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeSignedRequest(payload: object, secret: string = APP_SECRET): string {
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return `${base64url(sig)}.${payloadB64}`;
}

interface MockPrisma {
  contact: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  conversationThread: { deleteMany: ReturnType<typeof vi.fn> };
  opportunity: { deleteMany: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  lifecycleRevenueEvent: {
    deleteMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  ownerTask: { deleteMany: ReturnType<typeof vi.fn> };
  contactLifecycle: { deleteMany: ReturnType<typeof vi.fn> };
  conversationMessage: { deleteMany: ReturnType<typeof vi.fn> };
  conversationState: { deleteMany: ReturnType<typeof vi.fn> };
  whatsAppMessageStatus: { deleteMany: ReturnType<typeof vi.fn> };
  escalationRecord: { deleteMany: ReturnType<typeof vi.fn> };
  handoff: { deleteMany: ReturnType<typeof vi.fn> };
  interactionSummary: { deleteMany: ReturnType<typeof vi.fn> };
  booking: { deleteMany: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  conversionRecord: { deleteMany: ReturnType<typeof vi.fn> };
  pendingLeadRetry: { deleteMany: ReturnType<typeof vi.fn> };
  receipt: { deleteMany: ReturnType<typeof vi.fn> };
  receiptedBooking: { deleteMany: ReturnType<typeof vi.fn> };
  workTrace: { deleteMany: ReturnType<typeof vi.fn> };
  conversationLifecycleSnapshot: { deleteMany: ReturnType<typeof vi.fn> };
  conversationLifecycleTransition: { deleteMany: ReturnType<typeof vi.fn> };
  scheduledFollowUp: { deleteMany: ReturnType<typeof vi.fn> };
  scheduledReminder: { deleteMany: ReturnType<typeof vi.fn> };
  robinRecoverySend: { deleteMany: ReturnType<typeof vi.fn> };
  whatsAppTestSend: { deleteMany: ReturnType<typeof vi.fn> };
  failedMessage: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  dataDeletionRequest: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

function makePrisma(): MockPrisma {
  const px: MockPrisma = {
    contact: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: "c-1", phone: "+12345" }),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conversationThread: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    opportunity: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    lifecycleRevenueEvent: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ownerTask: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    contactLifecycle: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationState: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    whatsAppMessageStatus: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    escalationRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    handoff: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    interactionSummary: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    booking: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    conversionRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    pendingLeadRetry: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    receipt: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    receiptedBooking: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workTrace: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationLifecycleSnapshot: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationLifecycleTransition: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    scheduledFollowUp: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    scheduledReminder: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    robinRecoverySend: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    whatsAppTestSend: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    failedMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    dataDeletionRequest: {
      create: vi.fn().mockImplementation(async ({ data }: { data: object }) => data),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(),
  };
  px.$transaction.mockImplementation(async (fnOrArr: unknown) => {
    if (typeof fnOrArr === "function") return (fnOrArr as (tx: MockPrisma) => unknown)(px);
    return fnOrArr;
  });
  return px;
}

async function buildApp(
  prisma: MockPrisma,
  opts: { calendarProviderFactory?: CalendarProviderFactory } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  // PrismaContactStore is the real implementation; we only mock the prisma client.
  app.decorate("prisma", prisma as unknown as never);
  await app.register(metaDeletionRoutes, {
    prefix: "/api/meta/deletion",
    appSecret: APP_SECRET,
    ...(opts.calendarProviderFactory
      ? { calendarProviderFactory: opts.calendarProviderFactory }
      : {}),
  });
  return app;
}

// Like buildApp, but with a real pino logger writing ndjson into `lines` so we
// can assert what the error paths log (the default buildApp uses logger:false).
async function buildCapturingApp(
  prisma: MockPrisma,
): Promise<{ app: FastifyInstance; lines: string[] }> {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      lines.push(chunk.toString("utf8"));
      callback();
    },
  });
  const app = Fastify({ logger: { level: "error", stream } });
  await app.register(formbody);
  app.decorate("prisma", prisma as unknown as never);
  await app.register(metaDeletionRoutes, { prefix: "/api/meta/deletion", appSecret: APP_SECRET });
  return { app, lines };
}

function parseLogLines(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .join("")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("POST /api/meta/deletion", () => {
  let prisma: MockPrisma;
  let app: FastifyInstance;

  beforeEach(async () => {
    prisma = makePrisma();
    app = await buildApp(prisma);
  });

  it("returns 400 when signed_request is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Missing signed_request/);
    await app.close();
  });

  it("returns 400 when signed_request signature is invalid", async () => {
    const sr = makeSignedRequest({ user_id: "12345" }, "wrong-secret");
    const res = await app.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(sr)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid signed_request/);
    await app.close();
  });

  it("returns 200 with url + confirmation_code on valid signed_request, even when no contacts match", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    const sr = makeSignedRequest({ user_id: "6591234567" });

    const res = await app.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        host: "api.example.com",
        "x-forwarded-proto": "https",
      },
      payload: `signed_request=${encodeURIComponent(sr)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.confirmation_code).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.url).toBe(
      `https://api.example.com/api/meta/deletion/status?code=${body.confirmation_code}`,
    );
    expect(prisma.dataDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "6591234567",
        confirmationCode: body.confirmation_code,
        deletedContactIds: [],
        status: "completed",
      }),
    });
    await app.close();
  });

  it("matches contacts by canonical phoneE164 OR raw phone shapes", async () => {
    const sr = makeSignedRequest({ user_id: "6591234567" });
    await app.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(sr)}`,
    });

    // The wa-id normalizes to canonical +E.164 (matched on phoneE164) AND the raw
    // phone shapes are kept as a fallback for legacy/unnormalized rows.
    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ phoneE164: "+6591234567" }, { phone: { in: ["6591234567", "+6591234567"] } }],
      },
      select: { id: true, organizationId: true },
    });
    await app.close();
  });

  it("deletes every matched contact via the cascade and records their ids", async () => {
    prisma.contact.findMany.mockResolvedValue([
      { id: "c-1", organizationId: "org-1" },
      { id: "c-2", organizationId: "org-2" },
    ]);
    prisma.contact.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      phone: "+6591234567",
    }));

    const sr = makeSignedRequest({ user_id: "6591234567" });
    const res = await app.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(sr)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.contact.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.dataDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deletedContactIds: ["c-1", "c-2"],
        status: "completed",
      }),
    });
    await app.close();
  });

  it("records status=failed when the cascade throws", async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: "c-1", organizationId: "org-1" }]);
    prisma.contact.findFirst.mockResolvedValue({ id: "c-1", phone: null });
    prisma.$transaction.mockRejectedValueOnce(new Error("db boom"));

    const sr = makeSignedRequest({ user_id: "6591234567" });
    const res = await app.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(sr)}`,
    });

    // Meta still gets a 200 with a confirmation_code; ops triages via the failed row.
    expect(res.statusCode).toBe(200);
    expect(prisma.dataDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "failed", failureReason: "db boom" }),
    });
    await app.close();
  });

  it("cancels the matched contact's external calendar events before deleting them (F5)", async () => {
    await app.close(); // discard the default app; use one with an injected calendar factory
    prisma.contact.findMany.mockResolvedValue([{ id: "c-1", organizationId: "org-1" }]);
    prisma.contact.findFirst.mockResolvedValue({ id: "c-1", phone: "+6591234567" });
    prisma.booking.findMany.mockResolvedValue([{ calendarEventId: "evt-google-1" }]);

    const cancelBooking = vi.fn(async () => undefined);
    const calendarProviderFactory = vi.fn(
      async () => ({ cancelBooking }) as unknown as CalendarProvider,
    );
    const calApp = await buildApp(prisma, { calendarProviderFactory });

    const sr = makeSignedRequest({ user_id: "6591234567" });
    const res = await calApp.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(sr)}`,
    });

    expect(res.statusCode).toBe(200);
    // Reads the contact's booking event ids (scoped), resolves the org's provider,
    // and cancels the external event — all before the DB cascade removes the rows.
    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: { contactId: "c-1", organizationId: "org-1" },
      select: { calendarEventId: true },
    });
    expect(calendarProviderFactory).toHaveBeenCalledWith("org-1");
    expect(cancelBooking).toHaveBeenCalledWith("evt-google-1", expect.any(String));
    expect(prisma.contact.deleteMany).toHaveBeenCalled();
    expect(prisma.dataDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deletedContactIds: ["c-1"], status: "completed" }),
    });
    await calApp.close();
  });

  it("records status=partial when an external calendar cancel is swallowed (F5)", async () => {
    await app.close(); // discard the default app; use one with an injected calendar factory
    prisma.contact.findMany.mockResolvedValue([{ id: "c-1", organizationId: "org-1" }]);
    prisma.contact.findFirst.mockResolvedValue({ id: "c-1", phone: "+6591234567" });
    prisma.booking.findMany.mockResolvedValue([{ calendarEventId: "evt-google-1" }]);

    const cancelBooking = vi.fn(async () => {
      throw new Error("google calendar down");
    });
    const calendarProviderFactory = vi.fn(
      async () => ({ cancelBooking }) as unknown as CalendarProvider,
    );
    const calApp = await buildApp(prisma, { calendarProviderFactory });

    const sr = makeSignedRequest({ user_id: "6591234567" });
    const res = await calApp.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(sr)}`,
    });

    // The contact IS erased from the DB (200, recorded deleted), but the outcome is
    // honest: the external event lingered, so status is "partial", never "completed".
    expect(res.statusCode).toBe(200);
    expect(cancelBooking).toHaveBeenCalled();
    expect(prisma.contact.deleteMany).toHaveBeenCalled();
    expect(prisma.dataDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deletedContactIds: ["c-1"], status: "partial" }),
    });
    await calApp.close();
  });
});

describe("POST /api/meta/deletion — error-path logging (F10/PDPA)", () => {
  it("never writes the full phone to the cascade-failure log line", async () => {
    const phone = "6591234567";
    const prisma = makePrisma();
    prisma.contact.findMany.mockResolvedValue([{ id: "c-1", organizationId: "org-1" }]);
    prisma.contact.findFirst.mockResolvedValue({ id: "c-1", phone: null });
    // The cascade runs inside $transaction; reject it AND quote the phone in the
    // message to prove the err is sanitized, not just userId.
    prisma.$transaction.mockRejectedValueOnce(new Error(`delete failed for ${phone}`));

    const { app, lines } = await buildCapturingApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(makeSignedRequest({ user_id: phone }))}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const entry = parseLogLines(lines).find(
      (e) => typeof e.msg === "string" && (e.msg as string).includes("cascade delete failed"),
    );
    expect(entry).toBeDefined();
    expect(entry!.userIdMasked).toBe("…4567");
    expect(JSON.stringify(entry)).not.toContain(phone);
    expect(JSON.stringify(entry)).not.toContain(`+${phone}`);
  });

  it("never writes the full phone to the persist-failure log line", async () => {
    const phone = "6591234567";
    const prisma = makePrisma();
    prisma.contact.findMany.mockResolvedValue([]); // no cascade
    prisma.dataDeletionRequest.create.mockRejectedValueOnce(
      new Error(`insert failed for ${phone}`),
    );

    const { app, lines } = await buildCapturingApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/meta/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(makeSignedRequest({ user_id: phone }))}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const entry = parseLogLines(lines).find(
      (e) => typeof e.msg === "string" && (e.msg as string).includes("failed to persist"),
    );
    expect(entry).toBeDefined();
    expect(entry!.userIdMasked).toBe("…4567");
    expect(JSON.stringify(entry)).not.toContain(phone);
  });
});

describe("GET /api/meta/deletion/status", () => {
  let prisma: MockPrisma;
  let app: FastifyInstance;

  beforeEach(async () => {
    prisma = makePrisma();
    app = await buildApp(prisma);
  });

  it("returns 400 when code is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/meta/deletion/status" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 when the code is unknown", async () => {
    prisma.dataDeletionRequest.findUnique.mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: "/api/meta/deletion/status?code=missing",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 200 with the deletion record when found", async () => {
    prisma.dataDeletionRequest.findUnique.mockResolvedValue({
      status: "completed",
      completedAt: new Date("2026-05-07T15:00:00Z"),
      createdAt: new Date("2026-05-07T14:59:00Z"),
      deletedContactIds: ["c-1", "c-2"],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/meta/deletion/status?code=abc123",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("completed");
    expect(body.completed_at).toBe("2026-05-07T15:00:00.000Z");
    expect(body.deleted_record_count).toBe(2);
    await app.close();
  });
});
