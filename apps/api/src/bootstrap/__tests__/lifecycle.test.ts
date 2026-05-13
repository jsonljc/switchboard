import { describe, expect, it, vi } from "vitest";
import { bootstrapLifecycle } from "../lifecycle.js";

function makeRegistrarMocks() {
  return {
    registerVerdictWriteHook: vi.fn(),
    registerBookingCreateHook: vi.fn(),
    registerInboundMessageHook: vi.fn(),
    registerOperatorTakeoverHook: vi.fn(),
    registerThreadInitHook: vi.fn(),
    registerCron: vi.fn(),
  };
}

describe("bootstrapLifecycle", () => {
  it("constructs a writer + attributor and registers all five event hooks plus cron", () => {
    const registered: string[] = [];
    const registrars = makeRegistrarMocks();
    const result = bootstrapLifecycle({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: {} as any,
      readMode: async () => "off",
      playbookReader: { readForOrganization: async () => null },
      governanceConfigResolver: { resolve: async () => ({}) },
      ...registrars,
      onHookRegister: (name: string) => registered.push(name),
    });
    expect(result.writer).toBeDefined();
    expect(result.attributor).toBeDefined();
    expect(result.snapshotStore).toBeDefined();
    expect(result.history).toBeDefined();
    expect(registrars.registerVerdictWriteHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerBookingCreateHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerInboundMessageHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerOperatorTakeoverHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerThreadInitHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerCron).toHaveBeenCalledWith(
      "lifecycle.stalled-sweep",
      "0 * * * *",
      expect.any(Function),
    );
    expect(registered.sort()).toEqual([
      "booking-created",
      "governance-verdict-escalation",
      "inbound-message",
      "operator-takeover",
      "stalled-sweep-cron",
      "thread-first-observation",
    ]);
  });
});
