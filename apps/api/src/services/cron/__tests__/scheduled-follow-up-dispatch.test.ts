import { describe, it, expect, vi } from "vitest";
import {
  executeScheduledFollowUpDispatch,
  createScheduledFollowUpDispatchCron,
} from "../scheduled-follow-up-dispatch.js";
import type { ScheduledFollowUpDispatchDeps, StepTools } from "../scheduled-follow-up-dispatch.js";
import type { AsyncFailureContext, DueScheduledFollowUp } from "@switchboard/core";

const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));
vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({ createFunction: createFunctionSpy })),
}));

function makeStep(): StepTools {
  return { run: async <T>(_n: string, fn: () => T | Promise<T>): Promise<T> => fn() };
}

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

function makeDue(over = {}) {
  return {
    id: "fu_1",
    organizationId: "org_1",
    contactId: "contact_1",
    conversationThreadId: "thread_1",
    sessionId: "thread_1",
    deploymentId: "dep_1",
    workUnitId: "wu_1",
    channel: "whatsapp",
    jurisdiction: "SG",
    templateIntentClass: "re-engagement-offer",
    reason: "went_quiet",
    note: null,
    attempts: 0,
    dueAt: new Date("2026-06-04T09:00:00Z"),
    touchNumber: 1,
    cadenceId: null,
    ...over,
  };
}

function makeDeps(
  over: Partial<ScheduledFollowUpDispatchDeps> = {},
): ScheduledFollowUpDispatchDeps {
  return {
    failure: makeFailureContext(),
    findDueFollowUps: vi.fn().mockResolvedValue([makeDue()]),
    submitFollowUpSend: vi.fn().mockResolvedValue({
      ok: true,
      result: { outputs: { sent: true } },
      workUnit: {},
    }),
    createFollowUp: vi.fn().mockResolvedValue({ id: "fu_2" }),
    markSent: vi.fn(),
    markSkipped: vi.fn(),
    markFailed: vi.fn(),
    markDeferred: vi.fn(),
    now: () => new Date("2026-06-04T10:00:00Z"),
    ...over,
  };
}

describe("executeScheduledFollowUpDispatch", () => {
  it("submits each due follow-up through the ingress closure and marks it sent", async () => {
    const deps = makeDeps();
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r).toEqual({ processed: 1, sent: 1, skipped: 0, failed: 0 });
    expect(deps.submitFollowUpSend).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        contactId: "contact_1",
        conversationThreadId: "thread_1",
        channel: "whatsapp",
        templateIntentClass: "re-engagement-offer",
        reason: "went_quiet",
        followUpId: "fu_1",
      }),
    );
    expect(deps.markSent).toHaveBeenCalledWith("fu_1");
  });

  it("records a durable skip (consent_revoked) directly as terminal", async () => {
    const deps = makeDeps({
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "consent_revoked" } },
        workUnit: {},
      }),
    });
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r.skipped).toBe(1);
    expect(deps.markSkipped).toHaveBeenCalledWith("fu_1", "consent_revoked");
  });

  it("retries with backoff on a failed submit below the attempt cap", async () => {
    const deps = makeDeps({
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: false,
        error: { type: "upstream_error", intent: "conversation.followup.send", message: "boom" },
      }),
    });
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r.failed).toBe(1);
    const [id, , nextRetryAt] = (deps.markFailed as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe("fu_1");
    expect((nextRetryAt as Date).getTime()).toBeGreaterThan(deps.now!().getTime());
  });

  it("terminates (no nextRetryAt) at the final attempt", async () => {
    const deps = makeDeps({
      findDueFollowUps: vi.fn().mockResolvedValue([makeDue({ attempts: 2 })]),
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: false,
        error: { type: "upstream_error", intent: "conversation.followup.send", message: "boom" },
      }),
    });
    await executeScheduledFollowUpDispatch(makeStep(), deps);
    const [, , nextRetryAt] = (deps.markFailed as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(nextRetryAt).toBeNull();
  });

  it("returns zeros when nothing is due", async () => {
    const deps = makeDeps({ findDueFollowUps: vi.fn().mockResolvedValue([]) });
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r).toEqual({ processed: 0, sent: 0, skipped: 0, failed: 0 });
  });
});

describe("createScheduledFollowUpDispatchCron — onFailure wiring", () => {
  it("passes a function onFailure into createFunction config", () => {
    createFunctionSpy.mockClear();
    createScheduledFollowUpDispatchCron(makeDeps());
    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });
});

const cadenceStep = { run: async <T>(_n: string, fn: () => T | Promise<T>) => fn() };
const CADENCE_NOW = new Date("2026-06-04T00:00:00.000Z");
function cadenceDue(o: Partial<DueScheduledFollowUp> = {}): DueScheduledFollowUp {
  return {
    id: "fu_1",
    organizationId: "org_1",
    contactId: "c_1",
    conversationThreadId: "th_1",
    sessionId: "th_1",
    deploymentId: "dep_1",
    workUnitId: "wu_1",
    channel: "whatsapp",
    jurisdiction: "SG",
    reason: "hesitation",
    note: null,
    templateIntentClass: "re-engagement-offer",
    attempts: 0,
    dueAt: new Date("2026-06-02T00:00:00.000Z"),
    touchNumber: 1,
    cadenceId: "cad_1",
    ...o,
  };
}
function cadenceDeps(over: Record<string, unknown> = {}) {
  return {
    failure: {} as never,
    findDueFollowUps: vi.fn().mockResolvedValue([cadenceDue()]),
    submitFollowUpSend: vi
      .fn()
      .mockResolvedValue({ ok: true, result: { outputs: { sent: true } } }),
    createFollowUp: vi.fn().mockResolvedValue({ id: "fu_2" }),
    markSent: vi.fn(),
    markSkipped: vi.fn(),
    markFailed: vi.fn(),
    markDeferred: vi.fn(),
    now: () => CADENCE_NOW,
    ...over,
  };
}

describe("cadence advance dispatch", () => {
  it("sent + touch 1 → markSent then creates touch 2 at now+3d", async () => {
    const d = cadenceDeps();
    await executeScheduledFollowUpDispatch(cadenceStep, d as never);
    expect(d.markSent).toHaveBeenCalledWith("fu_1");
    expect(d.createFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        touchNumber: 2,
        cadenceId: "cad_1",
        dueAt: new Date("2026-06-07T00:00:00.000Z"),
        dedupeKey: "followup:org_1:c_1:2026-06-07:t2",
      }),
    );
  });

  it("sent + touch 3 → no touch 4", async () => {
    const d = cadenceDeps({
      findDueFollowUps: vi.fn().mockResolvedValue([cadenceDue({ touchNumber: 3 })]),
    });
    await executeScheduledFollowUpDispatch(cadenceStep, d as never);
    expect(d.markSent).toHaveBeenCalled();
    expect(d.createFollowUp).not.toHaveBeenCalled();
  });

  it("legacy row (cadenceId null) sent → no advance", async () => {
    const d = cadenceDeps({
      findDueFollowUps: vi.fn().mockResolvedValue([cadenceDue({ cadenceId: null })]),
    });
    await executeScheduledFollowUpDispatch(cadenceStep, d as never);
    expect(d.createFollowUp).not.toHaveBeenCalled();
  });

  it("durable skip (consent_revoked) → terminal markSkipped, no advance", async () => {
    const d = cadenceDeps({
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "consent_revoked" } },
      }),
    });
    await executeScheduledFollowUpDispatch(cadenceStep, d as never);
    expect(d.markSkipped).toHaveBeenCalledWith("fu_1", "consent_revoked");
    expect(d.markDeferred).not.toHaveBeenCalled();
    expect(d.createFollowUp).not.toHaveBeenCalled();
  });

  it("activation skip (template_not_approved) within window → markDeferred (re-evaluable)", async () => {
    const d = cadenceDeps({
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "template_not_approved" } },
      }),
    });
    await executeScheduledFollowUpDispatch(cadenceStep, d as never);
    expect(d.markDeferred).toHaveBeenCalledWith(
      "fu_1",
      "template_not_approved",
      new Date("2026-06-04T01:00:00.000Z"),
    );
    expect(d.markSkipped).not.toHaveBeenCalled();
  });

  it("activation skip past the 14d overdue cap → terminal stale_unsent", async () => {
    const d = cadenceDeps({
      findDueFollowUps: vi
        .fn()
        .mockResolvedValue([cadenceDue({ dueAt: new Date("2026-05-01T00:00:00.000Z") })]),
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "template_not_approved" } },
      }),
    });
    await executeScheduledFollowUpDispatch(cadenceStep, d as never);
    expect(d.markSkipped).toHaveBeenCalledWith("fu_1", "stale_unsent");
    expect(d.markDeferred).not.toHaveBeenCalled();
  });

  it("next-touch create that hits the unique constraint is swallowed (idempotent)", async () => {
    const d = cadenceDeps({ createFollowUp: vi.fn().mockRejectedValue({ code: "P2002" }) });
    await expect(executeScheduledFollowUpDispatch(cadenceStep, d as never)).resolves.toBeDefined();
  });
});
