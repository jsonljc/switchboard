import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface ManagedChannelRow {
  id: string;
  channel: string;
  status: string;
  connectionId: string;
}

function makePrisma(channels: ManagedChannelRow[]): {
  managedChannel: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
} {
  return {
    managedChannel: {
      findMany: vi.fn().mockResolvedValue(channels),
      update: vi
        .fn()
        .mockImplementation(async (args: { where: { id: string }; data: unknown }) => ({
          id: args.where.id,
          ...(args.data as object),
        })),
    },
  };
}

describe("runHealthCheck — transition matrix", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env["ALERT_WEBHOOK_URL"] = "https://hooks.example/test";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock("@switchboard/db");
    delete process.env["ALERT_WEBHOOK_URL"];
    delete process.env["META_SYSTEM_USER_TOKEN"];
  });

  function graphFetchCalls(): Array<[string, RequestInit]> {
    return fetchMock.mock.calls
      .filter(([url]) => String(url ?? "").startsWith("https://graph.facebook.com/"))
      .map(([url, init]) => [String(url), init as RequestInit]);
  }

  function channelUpdates(prisma: ReturnType<typeof makePrisma>): Array<{
    status: string;
    statusDetail: string | null;
  }> {
    return prisma.managedChannel.update.mock.calls.map(
      ([args]) => (args as { data: { status: string; statusDetail: string | null } }).data,
    );
  }

  function mockTelegramHealth(ok: boolean) {
    fetchMock.mockImplementation(async (url: string) => {
      if (new URL(url).host === "api.telegram.org") {
        return {
          ok,
          status: ok ? 200 : 401,
          statusText: ok ? "OK" : "Unauthorized",
          json: async () => ({ ok }),
        };
      }
      return { ok: true, status: 200, statusText: "OK" };
    });
  }

  function isWebhookCall(url: unknown): url is string {
    return typeof url === "string" && new URL(url).host === "hooks.example";
  }

  function webhookCallCount(): number {
    return fetchMock.mock.calls.filter(([url]) => isWebhookCall(url)).length;
  }

  function webhookBodies(): Array<{ text: string }> {
    return fetchMock.mock.calls
      .filter(([url]) => isWebhookCall(url))
      .map(([, init]) => JSON.parse((init as { body: string }).body));
  }

  function setupConnectionStoreMock() {
    vi.doMock("@switchboard/db", () => ({
      PrismaConnectionStore: vi.fn().mockImplementation(() => ({
        getById: vi.fn().mockResolvedValue({
          credentials: { botToken: "tg-token" },
        }),
      })),
    }));
  }

  it("active → error fires one failure webhook", async () => {
    setupConnectionStoreMock();
    mockTelegramHealth(false);
    const prisma = makePrisma([
      { id: "ch-a", channel: "telegram", status: "active", connectionId: "c1" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    expect(webhookCallCount()).toBe(1);
    expect(webhookBodies()[0]?.text).toContain("🚨 Chat health check failed: telegram/ch-a");
  });

  it("error → error fires no webhook", async () => {
    setupConnectionStoreMock();
    mockTelegramHealth(false);
    const prisma = makePrisma([
      { id: "ch-b", channel: "telegram", status: "error", connectionId: "c1" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    expect(webhookCallCount()).toBe(0);
  });

  it("error → active fires one recovery webhook", async () => {
    setupConnectionStoreMock();
    mockTelegramHealth(true);
    const prisma = makePrisma([
      { id: "ch-c", channel: "telegram", status: "error", connectionId: "c1" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    expect(webhookCallCount()).toBe(1);
    expect(webhookBodies()[0]?.text).toContain("✅ Chat health recovered: telegram/ch-c");
  });

  it("active → active fires no webhook", async () => {
    setupConnectionStoreMock();
    mockTelegramHealth(true);
    const prisma = makePrisma([
      { id: "ch-d", channel: "telegram", status: "active", connectionId: "c1" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    expect(webhookCallCount()).toBe(0);
  });

  it("provisioning → error fires one failure webhook", async () => {
    setupConnectionStoreMock();
    mockTelegramHealth(false);
    const prisma = makePrisma([
      { id: "ch-e", channel: "telegram", status: "provisioning", connectionId: "c1" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    expect(webhookCallCount()).toBe(1);
    expect(webhookBodies()[0]?.text).toContain("🚨 Chat health check failed: telegram/ch-e");
  });

  it("provisioning → active fires no webhook", async () => {
    setupConnectionStoreMock();
    mockTelegramHealth(true);
    const prisma = makePrisma([
      { id: "ch-f", channel: "telegram", status: "provisioning", connectionId: "c1" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    expect(webhookCallCount()).toBe(0);
  });

  it("checkWhatsApp uses v21.0 in the Graph API URL", async () => {
    vi.doMock("@switchboard/db", () => ({
      PrismaConnectionStore: vi.fn().mockImplementation(() => ({
        getById: vi.fn().mockResolvedValue({
          credentials: { token: "wa-token", phoneNumberId: "pn-123" },
        }),
      })),
    }));

    fetchMock.mockImplementation(async (_url: string) => {
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ ok: true }) };
    });

    const prisma = makePrisma([
      { id: "ch-wa", channel: "whatsapp", status: "active", connectionId: "c-wa" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    const graphCalls = fetchMock.mock.calls
      .map((args) => String(args[0] ?? ""))
      .filter((url) => url.startsWith("https://graph.facebook.com/"));
    expect(graphCalls.length).toBeGreaterThan(0);
    expect(graphCalls[0]).toContain("/v21.0/");
  });

  it("whatsapp with no creds.token but META_SYSTEM_USER_TOKEN set is probed (not dropped)", async () => {
    // Runtime (runtime-registry.ts) loads this channel via resolveWhatsAppRuntimeToken's
    // system-token fallback; the health checker must mirror it instead of flipping the
    // channel to `error` (which the registry then drops on its status:"active" reload).
    process.env["META_SYSTEM_USER_TOKEN"] = "SYSTEM_TOKEN";
    vi.doMock("@switchboard/db", () => ({
      PrismaConnectionStore: vi.fn().mockImplementation(() => ({
        getById: vi.fn().mockResolvedValue({
          credentials: { phoneNumberId: "pn-123" }, // no per-connection token
        }),
      })),
    }));
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    }));

    const prisma = makePrisma([
      { id: "ch-wa-sys", channel: "whatsapp", status: "active", connectionId: "c-wa" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    // It must actually probe Graph with the system-user token (proving the fallback ran).
    const calls = graphFetchCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]?.[0]).toContain("/v21.0/pn-123");
    expect((calls[0]?.[1].headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer SYSTEM_TOKEN",
    );

    // And it must NOT have been flipped to error / "Missing WhatsApp credentials".
    const updates = channelUpdates(prisma);
    expect(updates.some((d) => d.status === "error")).toBe(false);
    expect(updates.some((d) => d.statusDetail === "Missing WhatsApp credentials")).toBe(false);
    expect(updates.at(-1)?.status).toBe("active");
  });

  it("whatsapp with no token anywhere still flips to error (fallback masks nothing)", async () => {
    delete process.env["META_SYSTEM_USER_TOKEN"];
    vi.doMock("@switchboard/db", () => ({
      PrismaConnectionStore: vi.fn().mockImplementation(() => ({
        getById: vi.fn().mockResolvedValue({
          credentials: { phoneNumberId: "pn-123" }, // no token, no system token
        }),
      })),
    }));
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    }));

    const prisma = makePrisma([
      { id: "ch-wa-bare", channel: "whatsapp", status: "active", connectionId: "c-wa" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    // Genuinely unconfigured: no Graph probe, honest error surfaced.
    expect(graphFetchCalls().length).toBe(0);
    const last = channelUpdates(prisma).at(-1);
    expect(last?.status).toBe("error");
    expect(last?.statusDetail).toBe("Missing WhatsApp credentials");
  });

  it("whatsapp with a system token but no phoneNumberId still flips to error (isolation boundary kept)", async () => {
    // phoneNumberId is the tenant FROM-identity / isolation boundary and stays required even
    // when the token resolves via the shared system-user fallback.
    process.env["META_SYSTEM_USER_TOKEN"] = "SYSTEM_TOKEN";
    vi.doMock("@switchboard/db", () => ({
      PrismaConnectionStore: vi.fn().mockImplementation(() => ({
        getById: vi.fn().mockResolvedValue({ credentials: {} }), // no phoneNumberId
      })),
    }));
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    }));

    const prisma = makePrisma([
      { id: "ch-wa-nophone", channel: "whatsapp", status: "active", connectionId: "c-wa" },
    ]);

    const { runHealthCheck } = await import("../managed/health-checker.js");
    await runHealthCheck(prisma as never);

    expect(graphFetchCalls().length).toBe(0);
    const last = channelUpdates(prisma).at(-1);
    expect(last?.status).toBe("error");
    expect(last?.statusDetail).toBe("Missing WhatsApp credentials");
  });
});
