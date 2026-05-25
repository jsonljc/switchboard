import { describe, expect, it, vi } from "vitest";
import {
  createLifecycleStalledSweepCron,
  type LifecycleStalledSweepDeps,
} from "../lifecycle-stalled-sweep.js";
import type { AsyncFailureContext } from "@switchboard/core";

// Hoist the spy so it's available when vi.mock factory runs.
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: {
    createFunction: createFunctionSpy,
  },
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

function makeMinimalDeps(): LifecycleStalledSweepDeps {
  return {
    failure: makeFailureContext(),
    prisma: {
      conversationLifecycleSnapshot: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as LifecycleStalledSweepDeps["prisma"],
    writer: {
      write: vi.fn().mockResolvedValue(undefined),
    } as unknown as LifecycleStalledSweepDeps["writer"],
    history: {
      getLastOutbound: vi.fn().mockResolvedValue(null),
      getLastInbound: vi.fn().mockResolvedValue(null),
    } as unknown as LifecycleStalledSweepDeps["history"],
    readMode: vi.fn().mockResolvedValue("off" as const),
  };
}

// ---------------------------------------------------------------------------
// onFailure wiring — createLifecycleStalledSweepCron (Class E)
// ---------------------------------------------------------------------------

describe("createLifecycleStalledSweepCron — onFailure wiring", () => {
  it("passes onFailure into createFunction config", () => {
    createFunctionSpy.mockClear();
    createLifecycleStalledSweepCron(makeMinimalDeps());

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });
});
