import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emit } from "../telemetry";

describe("emit", () => {
  let sink: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sink = vi.fn();
    (window as unknown as { __switchboardTelemetry?: typeof sink }).__switchboardTelemetry = sink;
  });
  afterEach(() => {
    delete (window as unknown as { __switchboardTelemetry?: unknown }).__switchboardTelemetry;
  });

  it("forwards events to the global sink when present", () => {
    emit({ type: "approvals.viewed", pendingCount: 12 });
    expect(sink).toHaveBeenCalledWith({ type: "approvals.viewed", pendingCount: 12 });
  });

  it("no-ops when no global sink is present", () => {
    delete (window as unknown as { __switchboardTelemetry?: unknown }).__switchboardTelemetry;
    // Should not throw.
    emit({ type: "approvals.viewed", pendingCount: 12 });
  });
});
