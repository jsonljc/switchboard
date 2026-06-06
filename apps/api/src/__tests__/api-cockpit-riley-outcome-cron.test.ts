import { describe, it, expect, vi } from "vitest";
import {
  executeRileyOutcomeAttributionWorker,
  createRileyOutcomeAttributionWorker,
} from "../services/cron/riley-outcome-attribution.js";
import type { AsyncFailureContext } from "@switchboard/core";

// Hoist the spy so it's available when vi.mock factory runs.
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({
    createFunction: createFunctionSpy,
  })),
}));

function makeFailureContext(): AsyncFailureContext {
  return {
    auditLedger: {
      record: vi.fn().mockResolvedValue({}),
    } as unknown as AsyncFailureContext["auditLedger"],
    operatorAlerter: {
      alert: vi.fn().mockResolvedValue(undefined),
    } as unknown as AsyncFailureContext["operatorAlerter"],
    inngest: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

function buildDeps() {
  return {
    failure: makeFailureContext(),
    runRileyOutcomeAttribution: vi.fn().mockResolvedValue({
      orgId: "org-1",
      candidatesScanned: 0,
      skippedExisting: 0,
      outcomesWritten: 0,
      renderable: 0,
      corroborated: 0,
      hidden: 0,
      hiddenByFlag: {
        meta_data_missing: 0,
        zero_pre_baseline: 0,
        below_noise_floor: 0,
        same_campaign_overlap: 0,
      },
    }),
    readEnabledFlag: vi.fn().mockReturnValue(true),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const EVENT = { data: { orgId: "org-1" }, name: "riley.outcome.attribute" };

describe("createRileyOutcomeAttributionWorker", () => {
  it("invokes the orchestrator when enabled", async () => {
    const deps = buildDeps();
    const out = await executeRileyOutcomeAttributionWorker(deps, EVENT);
    expect(deps.runRileyOutcomeAttribution).toHaveBeenCalledWith({
      orgId: "org-1",
      now: expect.any(Date),
    });
    expect(out).toMatchObject({ orgId: "org-1" });
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it("no-ops with skipped:disabled when kill-switch is off", async () => {
    const deps = buildDeps();
    deps.readEnabledFlag.mockReturnValue(false);
    const out = await executeRileyOutcomeAttributionWorker(deps, EVENT);
    expect(deps.runRileyOutcomeAttribution).not.toHaveBeenCalled();
    expect(out).toEqual({ skipped: "disabled" });
    expect(deps.logger.info).toHaveBeenCalledWith(expect.objectContaining({ skipped: "disabled" }));
  });

  it("throws and logs on missing orgId", async () => {
    const deps = buildDeps();
    await expect(
      executeRileyOutcomeAttributionWorker(deps, { data: {}, name: "riley.outcome.attribute" }),
    ).rejects.toThrow(/missing orgId/);
    expect(deps.logger.error).toHaveBeenCalled();
    expect(deps.runRileyOutcomeAttribution).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onFailure wiring — createRileyOutcomeAttributionWorker (Class D)
// ---------------------------------------------------------------------------

describe("createRileyOutcomeAttributionWorker — onFailure wiring", () => {
  it("passes onFailure into createFunction config", () => {
    createFunctionSpy.mockClear();
    const deps = buildDeps();
    createRileyOutcomeAttributionWorker(deps);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("sets explicit retries: 2 in createFunction config", () => {
    createFunctionSpy.mockClear();
    const deps = buildDeps();
    createRileyOutcomeAttributionWorker(deps);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["retries"]).toBe(2);
  });
});
