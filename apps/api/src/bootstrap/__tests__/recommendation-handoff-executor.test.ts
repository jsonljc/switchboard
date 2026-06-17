import { describe, it, expect, vi } from "vitest";
import type { MarkActedByExecutionResult } from "@switchboard/db";
import { buildMarkHandoffRecommendationActed } from "../recommendation-handoff-executor.js";
import { HANDOFF_EXECUTION_RESOLVED_BY } from "../../services/workflows/recommendation-handoff-workflow.js";

describe("buildMarkHandoffRecommendationActed", () => {
  it("maps the dep args onto markActedByExecution and stamps the handoff sentinel", async () => {
    const markActedByExecution = vi
      .fn<
        (args: {
          id: string;
          organizationId: string;
          executableWorkUnitId: string;
          resolvedBy: string;
          executedAt: Date;
        }) => Promise<MarkActedByExecutionResult>
      >()
      .mockResolvedValue({ transitioned: true });

    const mark = buildMarkHandoffRecommendationActed({ markActedByExecution });
    const executedAt = new Date("2026-06-17T12:00:00.000Z");
    const res = await mark({
      organizationId: "org_x",
      recommendationId: "rec_1",
      executableWorkUnitId: "wu_handoff_1",
      executedAt,
    });

    expect(res).toEqual({ transitioned: true });
    expect(markActedByExecution).toHaveBeenCalledWith({
      // recommendationId maps to the store's `id` (the SOURCE recommendation row).
      id: "rec_1",
      organizationId: "org_x",
      executableWorkUnitId: "wu_handoff_1",
      // A handoff-specific machine sentinel, never a human principal and never the
      // pause/reallocate values.
      resolvedBy: HANDOFF_EXECUTION_RESOLVED_BY,
      executedAt,
    });
    expect(HANDOFF_EXECUTION_RESOLVED_BY).toBe("riley_handoff_self_execution");
  });

  it("passes through a benign no-transition result unchanged", async () => {
    const markActedByExecution = vi
      .fn<
        (args: {
          id: string;
          organizationId: string;
          executableWorkUnitId: string;
          resolvedBy: string;
          executedAt: Date;
        }) => Promise<MarkActedByExecutionResult>
      >()
      .mockResolvedValue({ transitioned: false, reason: "not_pending" });
    const mark = buildMarkHandoffRecommendationActed({ markActedByExecution });
    const res = await mark({
      organizationId: "org_x",
      recommendationId: "rec_1",
      executableWorkUnitId: "wu_handoff_1",
      executedAt: new Date(),
    });
    expect(res).toEqual({ transitioned: false, reason: "not_pending" });
  });
});
