import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setMetrics, createInMemoryMetrics } from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import { buildLeadIntakeIngressAdapter } from "../bootstrap/contained-workflows.js";

// The narrow request the InstantFormAdapter passes to the shim. The payload carries
// a PII phone + name so we can assert they are NEVER logged on a failure.
const REQ = {
  intent: "lead.intake",
  payload: {
    source: "instant_form",
    organizationId: "org_1",
    deploymentId: "dep_1",
    contact: { phone: "+6591234567", name: "Jane Doe" },
    attribution: {},
    idempotencyKey: "leadgen:LG123",
  },
  idempotencyKey: "leadgen:LG123",
};

function stubIngress(response: SubmitWorkResponse) {
  return { submit: vi.fn(async (): Promise<SubmitWorkResponse> => response) };
}

describe("buildLeadIntakeIngressAdapter (Instant Form submit shim — Gap B not-swallow)", () => {
  let metrics: ReturnType<typeof createInMemoryMetrics>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    metrics = createInMemoryMetrics();
    setMetrics(metrics);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("buckets an ingress-rejected (ok:false) submit: counter + warn, returns ok:false (NOT success)", async () => {
    const inc = vi.spyOn(metrics.instantFormLeadIntakeFailed, "inc");
    const ingress = stubIngress({
      ok: false,
      error: {
        type: "entitlement_required",
        intent: "lead.intake",
        message: "no entitlement",
        blockedStatus: "past_due",
      },
    });

    const result = await buildLeadIntakeIngressAdapter(ingress).submit(REQ);

    expect(result.ok).toBe(false);
    expect(inc).toHaveBeenCalledWith({ reason: "ingress_rejected", type: "entitlement_required" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("buckets an execution_failed (ok:true, outcome 'failed') submit and does NOT report success", async () => {
    const inc = vi.spyOn(metrics.instantFormLeadIntakeFailed, "inc");
    const ingress = stubIngress({
      ok: true,
      result: { outcome: "failed" },
      workUnit: {},
    } as unknown as SubmitWorkResponse);

    const result = await buildLeadIntakeIngressAdapter(ingress).submit(REQ);

    expect(result.ok).toBe(false);
    expect(inc).toHaveBeenCalledWith({ reason: "execution_failed", type: "failed" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("handles a parked (approvalRequired) submit EXPLICITLY — not swallowed, not success", async () => {
    const inc = vi.spyOn(metrics.instantFormLeadIntakeFailed, "inc");
    const ingress = stubIngress({
      ok: true,
      result: { outcome: "pending_approval" },
      workUnit: {},
      approvalRequired: true,
    } as unknown as SubmitWorkResponse);

    const result = await buildLeadIntakeIngressAdapter(ingress).submit(REQ);

    expect(result.ok).toBe(false);
    expect(inc).toHaveBeenCalledWith({ reason: "approval_required", type: "approval_required" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("passes a completed submit through unchanged ({ ok:true, result }) and never counts/warns", async () => {
    const inc = vi.spyOn(metrics.instantFormLeadIntakeFailed, "inc");
    const completed = {
      outcome: "completed",
      outputs: { contactId: "c_1", duplicate: false, outcome: "created" },
    };
    const ingress = stubIngress({
      ok: true,
      result: completed,
      workUnit: {},
    } as unknown as SubmitWorkResponse);

    const result = await buildLeadIntakeIngressAdapter(ingress).submit(REQ);

    expect(result).toEqual({ ok: true, result: completed });
    expect(inc).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("never logs PII (the lead's phone / name) on a failure, but does carry org/deployment ids", async () => {
    const ingress = stubIngress({
      ok: false,
      error: { type: "validation_failed", intent: "lead.intake", message: "bad" },
    });

    await buildLeadIntakeIngressAdapter(ingress).submit(REQ);

    const logged = warn.mock.calls.map((c) => c.map(String).join(" ")).join(" ");
    expect(logged).not.toContain("+6591234567");
    expect(logged).not.toContain("Jane Doe");
    expect(logged).toContain("org_1");
    expect(logged).toContain("dep_1");
  });
});
