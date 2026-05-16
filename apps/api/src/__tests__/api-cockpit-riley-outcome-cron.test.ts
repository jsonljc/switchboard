import { describe, it, expect, vi } from "vitest";
import { executeRileyOutcomeAttributionWorker } from "../services/cron/riley-outcome-attribution.js";

function buildDeps() {
  return {
    runRileyOutcomeAttribution: vi.fn().mockResolvedValue({
      orgId: "org-1",
      candidatesScanned: 0,
      skippedExisting: 0,
      outcomesWritten: 0,
      renderable: 0,
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
