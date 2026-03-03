import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockHandleTriggeredAlert = vi.fn();

vi.mock("../alerts/handler.js", () => ({
  handleTriggeredAlert: (...args: unknown[]) => mockHandleTriggeredAlert(...args),
}));

import { startDiagnosticScanner } from "../jobs/diagnostic-scanner.js";

describe("Diagnostic Scanner Job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when no enabled rules exist", async () => {
    const prisma = {
      alertRule: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const storageContext = {
      cartridges: { get: vi.fn(), list: vi.fn() },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startDiagnosticScanner({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 120_000,
    });

    // Advance past 30s initial delay
    await vi.advanceTimersByTimeAsync(30_000);

    expect(prisma.alertRule.findMany).toHaveBeenCalledTimes(1);
    expect(mockHandleTriggeredAlert).not.toHaveBeenCalled();

    cleanup();
  });

  it("skips snoozed rules via query filter", async () => {
    const prisma = {
      alertRule: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const storageContext = {
      cartridges: { get: vi.fn() },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startDiagnosticScanner({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 120_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(prisma.alertRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          enabled: true,
          OR: expect.arrayContaining([{ snoozedUntil: null }]),
        }),
      }),
    );

    cleanup();
  });

  it("runs diagnostic and evaluates rules via handler", async () => {
    const rules = [
      {
        id: "rule_1",
        organizationId: "org_1",
        platform: "meta",
        vertical: "commerce",
        metricPath: "primaryKPI.current",
        operator: "gt",
        threshold: 100,
      },
    ];
    const prisma = {
      alertRule: {
        findMany: vi.fn().mockResolvedValue(rules),
      },
    };
    const mockCartridge = {
      execute: vi.fn().mockResolvedValue({ data: { primaryKPI: { current: 150 } } }),
    };
    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(mockCartridge) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    mockHandleTriggeredAlert.mockResolvedValue(undefined);

    const cleanup = startDiagnosticScanner({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 120_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockCartridge.execute).toHaveBeenCalledWith(
      "digital-ads.funnel.diagnose",
      expect.any(Object),
      expect.objectContaining({ principalId: "system", organizationId: "org_1" }),
    );
    expect(mockHandleTriggeredAlert).toHaveBeenCalledWith(
      rules[0],
      expect.any(Object),
      prisma,
      expect.any(Object),
      logger,
    );

    cleanup();
  });

  it("continues scanning when one org fails", async () => {
    const rules = [
      { id: "rule_1", organizationId: "org_1", platform: "meta", vertical: "commerce" },
      { id: "rule_2", organizationId: "org_2", platform: "meta", vertical: "commerce" },
    ];
    const prisma = {
      alertRule: {
        findMany: vi.fn().mockResolvedValue(rules),
      },
    };
    const mockCartridge = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error("Org 1 failed"))
        .mockResolvedValueOnce({ data: { kpi: 1 } }),
    };
    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(mockCartridge) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startDiagnosticScanner({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 120_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    // Both orgs attempted — first fails, second succeeds
    expect(mockCartridge.execute).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), orgId: "org_1" }),
      "Failed to run diagnostic scan for org",
    );

    cleanup();
  });

  it("warns when cartridge is unavailable", async () => {
    const rules = [
      { id: "rule_1", organizationId: "org_1", platform: "meta", vertical: "commerce" },
    ];
    const prisma = {
      alertRule: {
        findMany: vi.fn().mockResolvedValue(rules),
      },
    };
    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(undefined) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startDiagnosticScanner({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 120_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org_1" }),
      "digital-ads cartridge not available, skipping org",
    );

    cleanup();
  });

  it("cleanup stops the interval", async () => {
    const prisma = {
      alertRule: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const storageContext = {
      cartridges: { get: vi.fn() },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startDiagnosticScanner({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 120_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(prisma.alertRule.findMany).toHaveBeenCalledTimes(1);

    cleanup();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.alertRule.findMany).toHaveBeenCalledTimes(1);
  });
});
