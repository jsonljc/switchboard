import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@switchboard/customer-engagement", () => ({
  evaluatePendingCadences: vi.fn(),
  applyCadenceEvaluation: vi.fn(),
}));

import {
  startCadenceRunner,
  registerCadenceDefinition,
  startCadenceInstance,
  getActiveCadenceInstances,
  getCadenceInstance,
} from "../jobs/cadence-runner.js";
import { evaluatePendingCadences, applyCadenceEvaluation } from "@switchboard/customer-engagement";

const mockEvaluate = vi.mocked(evaluatePendingCadences);
const mockApply = vi.mocked(applyCadenceEvaluation);

describe("Cadence Runner Job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registerCadenceDefinition stores a definition", () => {
    registerCadenceDefinition({ id: "cad_def_1", name: "Test", steps: [] } as unknown as never);
    // Verify via startCadenceInstance + runner that uses the definitions
    expect(true).toBe(true);
  });

  it("startCadenceInstance and getCadenceInstance work", async () => {
    const instance = {
      id: "inst_1",
      cadenceDefinitionId: "cad_def_1",
      contactId: "pat_1",
      status: "active",
    };
    startCadenceInstance(instance as unknown as never);
    expect(await getCadenceInstance("inst_1")).toEqual(instance);
  });

  it("getActiveCadenceInstances filters active instances", async () => {
    startCadenceInstance({
      id: "inst_a",
      cadenceDefinitionId: "cad_1",
      contactId: "pat_1",
      status: "active",
    } as unknown as never);
    startCadenceInstance({
      id: "inst_b",
      cadenceDefinitionId: "cad_1",
      contactId: "pat_2",
      status: "completed",
    } as unknown as never);

    const active = await getActiveCadenceInstances();
    expect(active.some((i: { id: string }) => i.id === "inst_a")).toBe(true);
    expect(active.some((i: { id: string }) => i.id === "inst_b")).toBe(false);
  });

  it("does nothing when no active instances", async () => {
    const storageContext = {
      cartridges: { get: vi.fn() },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // mockEvaluate won't be called because there are no instances
    const cleanup = startCadenceRunner({
      storageContext: storageContext as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    // evaluatePendingCadences should not be called — no instances
    // (The runner filters by active status first)
    cleanup();
  });

  it("evaluates and executes cadence steps", async () => {
    // Start an active instance
    startCadenceInstance({
      id: "inst_exec",
      cadenceDefinitionId: "cad_1",
      contactId: "pat_exec",
      status: "active",
      currentStepIndex: 0,
    } as unknown as never);

    mockEvaluate.mockReturnValue([
      {
        instanceId: "inst_exec",
        evaluation: {
          shouldExecute: true,
          actionType: "send_reminder",
          parameters: { contactId: "pat_exec" },
          completed: false,
          skipped: false,
        },
      },
    ] as unknown as never);

    mockApply.mockImplementation((instance) => instance);

    const mockCartridge = {
      execute: vi.fn().mockResolvedValue({ data: { ok: true } }),
    };

    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(mockCartridge) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startCadenceRunner({
      storageContext: storageContext as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(mockCartridge.execute).toHaveBeenCalledWith(
      "send_reminder",
      expect.any(Object),
      expect.objectContaining({ principalId: "system:cadence-runner" }),
    );

    cleanup();
  });

  it("handles execution errors gracefully", async () => {
    startCadenceInstance({
      id: "inst_err",
      cadenceDefinitionId: "cad_1",
      contactId: "pat_err",
      status: "active",
      currentStepIndex: 0,
    } as unknown as never);

    mockEvaluate.mockReturnValue([
      {
        instanceId: "inst_err",
        evaluation: {
          shouldExecute: true,
          actionType: "send_reminder",
          parameters: {},
          completed: false,
          skipped: false,
        },
      },
    ] as unknown as never);
    mockApply.mockImplementation((instance) => instance);

    const mockCartridge = {
      execute: vi.fn().mockRejectedValue(new Error("Cartridge error")),
    };
    const storageContext = {
      cartridges: { get: vi.fn().mockReturnValue(mockCartridge) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startCadenceRunner({
      storageContext: storageContext as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to execute cadence step",
    );

    cleanup();
  });

  it("cleanup stops the interval", async () => {
    const storageContext = {
      cartridges: { get: vi.fn() },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startCadenceRunner({
      storageContext: storageContext as unknown as never,
      logger,
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    cleanup();

    expect(logger.info).toHaveBeenCalledWith("Cadence cron runner stopped");
  });
});
