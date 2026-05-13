import { describe, expect, it, vi } from "vitest";
import { bootstrapLifecycle } from "../lifecycle.js";

function makeStubDeps() {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: { $transaction: vi.fn() } as any,
    readMode: vi.fn().mockResolvedValue("on" as const),
    registerVerdictWriteHook: vi.fn(),
    registerBookingCreateHook: vi.fn(),
    registerInboundMessageHook: vi.fn(),
    registerOperatorTakeoverHook: vi.fn(),
    registerThreadInitHook: vi.fn(),
    registerCron: vi.fn(),
    playbookReader: { readForOrganization: vi.fn().mockResolvedValue(null) },
    governanceConfigResolver: { resolve: vi.fn().mockResolvedValue({}) },
  };
}

describe("bootstrapLifecycle — Phase 3b additions", () => {
  it("exposes a disqualification resolution hook on the returned bootstrap", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrap = bootstrapLifecycle(makeStubDeps() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((bootstrap as any).disqualificationHook).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (bootstrap as any).disqualificationHook.confirm).toBe("function");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (bootstrap as any).disqualificationHook.dismiss).toBe("function");
  });

  it("exposes the qualification evaluation hook on the returned bootstrap", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrap = bootstrapLifecycle(makeStubDeps() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((bootstrap as any).qualificationEvaluationHook).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (bootstrap as any).qualificationEvaluationHook.onSidecarEmitted).toBe("function");
  });

  it("constructs a LifecycleWriter that supports both record and qualification mutations", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrap = bootstrapLifecycle(makeStubDeps() as any);
    expect(bootstrap.writer).toBeDefined();
    expect(typeof bootstrap.writer.recordTransition).toBe("function");
    expect(typeof bootstrap.writer.updateQualificationStatus).toBe("function");
  });
});
