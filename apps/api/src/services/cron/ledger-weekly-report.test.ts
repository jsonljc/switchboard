import { describe, it, expect, vi } from "vitest";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import {
  executeLedgerWeeklyReportScan,
  executeLedgerWeeklyReportDispatch,
  WEEKLY_REPORT_DISPATCH_EVENT,
  type LedgerWeeklyReportWorkerDeps,
} from "./ledger-weekly-report.js";

const FIXED_NOW = new Date("2026-06-15T13:00:00.000Z"); // Mon, ISO week 2026-W25.
const EXPECTED_WEEK = "2026-W25";

function okResponse(overrides?: Partial<SubmitWorkResponse>): SubmitWorkResponse {
  return {
    ok: true,
    result: {
      workUnitId: "wu_1",
      outcome: "completed",
      summary: "Weekly report delivered to 1 recipient(s)",
      outputs: { delivered: true, recipientCount: 1 },
      mode: "operator_mutation",
      durationMs: 1,
      traceId: "trace_1",
    },
    workUnit: { id: "wu_1" } as never,
    ...overrides,
  } as SubmitWorkResponse;
}

function makeDeps(
  submit: (input: {
    organizationId: string;
    idempotencyKey: string;
  }) => Promise<SubmitWorkResponse>,
  opts: { enabled?: boolean } = {},
): LedgerWeeklyReportWorkerDeps {
  return {
    readEnabledFlag: () => opts.enabled ?? true,
    submit,
    warn: vi.fn<(msg: string) => void>(),
    now: () => FIXED_NOW,
  };
}

describe("executeLedgerWeeklyReportScan", () => {
  it("flag off -> skipped:disabled and never submits", async () => {
    const submit = vi.fn<
      (input: { organizationId: string; idempotencyKey: string }) => Promise<SubmitWorkResponse>
    >(() => Promise.resolve(okResponse()));
    const deps = makeDeps(submit, { enabled: false });

    const result = await executeLedgerWeeklyReportScan(deps, "org_1");

    expect(result).toEqual({ skipped: "disabled" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits with an isoWeek-keyed idempotency key", async () => {
    const submit = vi.fn<
      (input: { organizationId: string; idempotencyKey: string }) => Promise<SubmitWorkResponse>
    >(() => Promise.resolve(okResponse()));
    const deps = makeDeps(submit);

    await executeLedgerWeeklyReportScan(deps, "org_1");

    expect(submit).toHaveBeenCalledWith({
      organizationId: "org_1",
      idempotencyKey: `ledger-weekly-report:org_1:${EXPECTED_WEEK}`,
    });
  });

  it("entitlement_required -> skipped:org_not_entitled", async () => {
    const submit = () =>
      Promise.resolve({
        ok: false,
        error: {
          type: "entitlement_required",
          intent: "x",
          message: "no",
          blockedStatus: "past_due",
        },
      } as SubmitWorkResponse);
    const result = await executeLedgerWeeklyReportScan(makeDeps(submit), "org_1");
    expect(result).toEqual({ skipped: "org_not_entitled" });
  });

  it("idempotency_in_flight -> skipped:claim_unresolved", async () => {
    const submit = () =>
      Promise.resolve({
        ok: false,
        error: { type: "idempotency_in_flight", intent: "x", message: "busy", retryable: false },
      } as SubmitWorkResponse);
    const result = await executeLedgerWeeklyReportScan(makeDeps(submit), "org_1");
    expect(result).toEqual({ skipped: "claim_unresolved" });
  });

  it("other submit error -> skipped:submit_failed with detail + warns", async () => {
    const warn = vi.fn<(msg: string) => void>();
    const submit = () =>
      Promise.resolve({
        ok: false,
        error: { type: "deployment_not_found", intent: "x", message: "no deployment" },
      } as SubmitWorkResponse);
    const result = await executeLedgerWeeklyReportScan(
      { readEnabledFlag: () => true, submit, warn, now: () => FIXED_NOW },
      "org_1",
    );
    expect(result).toEqual({ skipped: "submit_failed", detail: "deployment_not_found" });
    expect(warn).toHaveBeenCalled();
  });

  it("approvalRequired -> skipped:parked", async () => {
    const submit = () =>
      Promise.resolve(okResponse({ approvalRequired: true } as Partial<SubmitWorkResponse>));
    const result = await executeLedgerWeeklyReportScan(makeDeps(submit), "org_1");
    expect(result).toEqual({ skipped: "parked" });
  });

  it("outcome failed -> skipped:delivery_failed with the outcome + warns", async () => {
    const warn = vi.fn<(msg: string) => void>();
    const submit = () =>
      Promise.resolve(
        okResponse({
          result: {
            workUnitId: "wu_1",
            outcome: "failed",
            summary: "Email not configured",
            outputs: {},
            mode: "operator_mutation",
            durationMs: 1,
            traceId: "t",
            error: { code: "WEEKLY_REPORT_DELIVERY_FAILED", message: "Email not configured" },
          },
        } as Partial<SubmitWorkResponse>),
      );
    const result = await executeLedgerWeeklyReportScan(
      { readEnabledFlag: () => true, submit, warn, now: () => FIXED_NOW },
      "org_1",
    );
    expect(result).toEqual({ skipped: "delivery_failed", detail: "failed" });
    expect(warn).toHaveBeenCalled();
  });

  it("outcome completed -> returns the jobId (the work unit id)", async () => {
    const submit = () => Promise.resolve(okResponse());
    const result = await executeLedgerWeeklyReportScan(makeDeps(submit), "org_1");
    expect(result).toEqual({ jobId: "wu_1" });
  });
});

describe("executeLedgerWeeklyReportDispatch", () => {
  it("emits one scan event per active org", async () => {
    const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
    const step = { run: <T>(_n: string, fn: () => T | Promise<T>) => Promise.resolve(fn()) };
    const result = await executeLedgerWeeklyReportDispatch(step, {
      listActiveOrganizations: () => Promise.resolve(["org_1", "org_2"]),
      sendEvent: (event) => {
        sent.push(event as { name: string; data: Record<string, unknown> });
        return Promise.resolve();
      },
    });

    expect(result).toEqual({ dispatched: 2 });
    expect(sent).toEqual([
      { name: WEEKLY_REPORT_DISPATCH_EVENT, data: { organizationId: "org_1" } },
      { name: WEEKLY_REPORT_DISPATCH_EVENT, data: { organizationId: "org_2" } },
    ]);
  });
});
