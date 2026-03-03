import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as notifier from "../alerts/notifier.js";

// Mock the dynamic import of @switchboard/digital-ads to prevent hanging
vi.mock("@switchboard/digital-ads", () => ({
  formatDiagnostic: vi.fn((data: unknown) => `Formatted: ${JSON.stringify(data)}`),
}));

import { startScheduledReportJob } from "../jobs/scheduled-reports.js";

describe("Scheduled Reports Runner Job", () => {
  let notifySpy: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    notifySpy = vi
      .spyOn(notifier, "sendProactiveNotification")
      .mockResolvedValue([{ channel: "test", success: true }] as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    notifySpy.mockRestore();
  });

  it("does nothing when no due reports exist", async () => {
    const prisma = {
      scheduledReport: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    };
    const storageContext = {
      cartridges: { get: vi.fn() },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startScheduledReportJob({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(prisma.scheduledReport.findMany).toHaveBeenCalled();
    expect(notifySpy).not.toHaveBeenCalled();

    cleanup();
  });

  it("runs report, notifies, and updates timestamps", async () => {
    const report = {
      id: "rep_1",
      name: "Weekly Funnel",
      reportType: "funnel",
      platform: "meta",
      vertical: "commerce",
      organizationId: "org_1",
      deliveryChannels: ["slack"],
      deliveryTargets: ["#alerts"],
      cronExpression: "0 9 * * 1",
      timezone: "UTC",
    };

    const prisma = {
      scheduledReport: {
        findMany: vi.fn().mockResolvedValue([report]),
        update: vi.fn(),
      },
    };

    const mockCartridge = {
      execute: vi.fn().mockResolvedValue({ data: { summary: "test data" } }),
    };
    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(mockCartridge) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startScheduledReportJob({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockCartridge.execute).toHaveBeenCalledWith(
      "digital-ads.funnel.diagnose",
      expect.any(Object),
      expect.objectContaining({ organizationId: "org_1" }),
    );
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Scheduled Report: Weekly Funnel",
        severity: "info",
        channels: ["slack"],
      }),
      expect.any(Object),
      logger,
    );
    expect(prisma.scheduledReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rep_1" },
        data: expect.objectContaining({ lastRunAt: expect.any(Date) }),
      }),
    );

    cleanup();
  });

  it("warns when cartridge is unavailable", async () => {
    const report = {
      id: "rep_2",
      name: "Missing Cartridge",
      reportType: "funnel",
      organizationId: "org_1",
      deliveryChannels: [],
      deliveryTargets: [],
      cronExpression: "0 0 * * *",
      timezone: "UTC",
    };

    const prisma = {
      scheduledReport: {
        findMany: vi.fn().mockResolvedValue([report]),
        update: vi.fn(),
      },
    };
    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(undefined) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startScheduledReportJob({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: "rep_2" }),
      "digital-ads cartridge not available",
    );

    cleanup();
  });

  it("uses formatDiagnostic from digital-ads cartridge", async () => {
    const report = {
      id: "rep_3",
      name: "Formatted Report",
      reportType: "funnel",
      platform: "meta",
      vertical: "commerce",
      organizationId: "org_1",
      deliveryChannels: [],
      deliveryTargets: [],
      cronExpression: "0 0 * * *",
      timezone: "UTC",
    };

    const prisma = {
      scheduledReport: {
        findMany: vi.fn().mockResolvedValue([report]),
        update: vi.fn(),
      },
    };

    const mockCartridge = {
      execute: vi.fn().mockResolvedValue({ data: { kpi: 42 } }),
    };
    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(mockCartridge) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startScheduledReportJob({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(notifySpy).toHaveBeenCalled();
    const notification = notifySpy.mock.calls[0][0] as { body: string };
    expect(notification.body).toContain("42");

    cleanup();
  });

  it("continues when one report fails", async () => {
    const reports = [
      {
        id: "rep_fail",
        name: "Failing Report",
        reportType: "funnel",
        platform: "meta",
        vertical: "commerce",
        organizationId: "org_1",
        deliveryChannels: [],
        deliveryTargets: [],
        cronExpression: "0 0 * * *",
        timezone: "UTC",
      },
      {
        id: "rep_ok",
        name: "OK Report",
        reportType: "funnel",
        platform: "meta",
        vertical: "commerce",
        organizationId: "org_2",
        deliveryChannels: [],
        deliveryTargets: [],
        cronExpression: "0 0 * * *",
        timezone: "UTC",
      },
    ];

    const mockCartridge = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error("Report failed"))
        .mockResolvedValueOnce({ data: { ok: true } }),
    };

    const prisma = {
      scheduledReport: {
        findMany: vi.fn().mockResolvedValue(reports),
        update: vi.fn(),
      },
    };
    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(mockCartridge) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startScheduledReportJob({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    // First report fails, second succeeds
    expect(mockCartridge.execute).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), reportId: "rep_fail" }),
      "Failed to run scheduled report",
    );

    cleanup();
  });

  it("cleanup stops the interval", async () => {
    const prisma = {
      scheduledReport: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    };
    const storageContext = {
      cartridges: { get: vi.fn() },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startScheduledReportJob({
      prisma: prisma as any,
      storageContext: storageContext as any,
      logger,
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(prisma.scheduledReport.findMany).toHaveBeenCalledTimes(1);

    cleanup();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(prisma.scheduledReport.findMany).toHaveBeenCalledTimes(1);
  });
});
