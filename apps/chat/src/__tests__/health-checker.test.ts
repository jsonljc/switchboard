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
  });

  function mockTelegramHealth(ok: boolean) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.telegram.org")) {
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

  function webhookCallCount(): number {
    return fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && url.startsWith("https://hooks.example"),
    ).length;
  }

  function webhookBodies(): Array<{ text: string }> {
    return fetchMock.mock.calls
      .filter(([url]) => typeof url === "string" && url.startsWith("https://hooks.example"))
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
});
