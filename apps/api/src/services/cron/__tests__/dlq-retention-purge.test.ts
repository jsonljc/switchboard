import { describe, expect, it, vi } from "vitest";
import {
  executeDlqRetentionPurge,
  createDlqRetentionPurgeCron,
  resolveRetentionWindows,
} from "../dlq-retention-purge.js";
import type { DlqRetentionPurgeDeps, StepTools } from "../dlq-retention-purge.js";
import type { AsyncFailureContext } from "@switchboard/core";

// Hoist the spy so it's available when the vi.mock factory runs.
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
    },
    operatorAlerter: {
      alert: vi.fn().mockResolvedValue(undefined),
    },
    inngest: { send: vi.fn().mockResolvedValue(undefined) },
  } as unknown as AsyncFailureContext;
}

function makeStep(): StepTools {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()) as StepTools["run"],
  };
}

const NOW = new Date("2026-06-11T00:00:00Z");

function makeDeps(over: Partial<DlqRetentionPurgeDeps> = {}): DlqRetentionPurgeDeps {
  return {
    failure: makeFailureContext(),
    purge: vi.fn().mockResolvedValue({ purged: 5, batches: 1, truncated: false }),
    now: () => NOW,
    softRetentionDays: 30,
    hardRetentionDays: 90,
    logger: { info: vi.fn(), warn: vi.fn() },
    ...over,
  };
}

describe("resolveRetentionWindows", () => {
  it("defaults to 30/90 when env is absent or non-numeric", () => {
    expect(resolveRetentionWindows(undefined, undefined)).toEqual({ soft: 30, hard: 90 });
    expect(resolveRetentionWindows("abc", "")).toEqual({ soft: 30, hard: 90 });
  });

  it("parses numeric env values", () => {
    expect(resolveRetentionWindows("14", "60")).toEqual({ soft: 14, hard: 60 });
  });

  it("floors the hard cap so it is never tighter than the soft window", () => {
    expect(resolveRetentionWindows("45", "30")).toEqual({ soft: 45, hard: 45 });
  });

  it("rejects zero and negative values, falling back to defaults", () => {
    expect(resolveRetentionWindows("0", "-5")).toEqual({ soft: 30, hard: 90 });
  });
});

describe("executeDlqRetentionPurge", () => {
  it("computes cutoffs from now + windows and calls purge inside a step", async () => {
    const deps = makeDeps();
    const result = await executeDlqRetentionPurge(makeStep(), deps);
    expect(deps.purge).toHaveBeenCalledWith({
      softCutoff: new Date("2026-05-12T00:00:00Z"), // now - 30d
      hardCutoff: new Date("2026-03-13T00:00:00Z"), // now - 90d
      softStatuses: ["resolved", "exhausted"],
      batchSize: 1000,
      maxBatches: 100,
    });
    expect(result).toEqual({ purged: 5, batches: 1, truncated: false });
    expect(deps.logger.info).toHaveBeenCalled();
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });

  it("warns when the purge truncated", async () => {
    const deps = makeDeps({
      purge: vi.fn().mockResolvedValue({ purged: 100000, batches: 100, truncated: true }),
    });
    await executeDlqRetentionPurge(makeStep(), deps);
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});

describe("createDlqRetentionPurgeCron", () => {
  it("registers a daily function with a low-risk onFailure handler", () => {
    createDlqRetentionPurgeCron(makeDeps());
    const cfg = createFunctionSpy.mock.calls.at(-1)?.[0] as {
      id: string;
      triggers: Array<{ cron: string }>;
      onFailure: unknown;
    };
    expect(cfg.id).toBe("dlq-retention-purge");
    expect(cfg.triggers).toEqual([{ cron: "0 4 * * *" }]);
    expect(typeof cfg.onFailure).toBe("function");
  });
});
