import { describe, it, expect, vi } from "vitest";
import {
  executeScheduledFollowUpDispatch,
  createScheduledFollowUpDispatchCron,
} from "../scheduled-follow-up-dispatch.js";
import type { ScheduledFollowUpDispatchDeps, StepTools } from "../scheduled-follow-up-dispatch.js";
import type { AsyncFailureContext } from "@switchboard/core";

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
    channel: "whatsapp",
    templateIntentClass: "re-engagement-offer",
    reason: "went_quiet",
    attempts: 0,
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
    markSent: vi.fn(),
    markSkipped: vi.fn(),
    markFailed: vi.fn(),
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

  it("records a skip with the handler's reason", async () => {
    const deps = makeDeps({
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "template_not_approved" } },
        workUnit: {},
      }),
    });
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r.skipped).toBe(1);
    expect(deps.markSkipped).toHaveBeenCalledWith("fu_1", "template_not_approved");
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
