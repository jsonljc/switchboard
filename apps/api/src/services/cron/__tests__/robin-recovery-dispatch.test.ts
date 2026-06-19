import { describe, expect, it, vi } from "vitest";
import { executeRobinRecoveryDispatch } from "../robin-recovery-dispatch.js";

const step = { run: async <T>(_n: string, fn: () => T | Promise<T>) => fn() };
const NOW = new Date("2026-06-10T08:00:00.000Z");
const WINDOW_FROM = new Date("2026-05-27T08:00:00.000Z"); // NOW - 14d

function row(o: Record<string, unknown> = {}) {
  return {
    bookingId: "bk_1",
    contactId: "ct_1",
    service: "Botox",
    startsAt: new Date("2026-06-02T09:00:00.000Z"),
    attendeeName: "Mei",
    ...o,
  };
}

function deps(over: Record<string, unknown> = {}) {
  return {
    failure: {} as never,
    listRecoveryDeployments: vi
      .fn()
      .mockResolvedValue([
        { organizationId: "org_1", governanceConfig: { recovery: { mode: "enforce" } } },
      ]),
    findNoShowCandidates: vi.fn().mockResolvedValue([row()]),
    findFutureBookingContactIds: vi.fn().mockResolvedValue(new Set<string>()),
    submitRecoveryCampaign: vi.fn().mockResolvedValue({
      ok: true,
      approvalRequired: true,
      result: { outcome: "pending_approval" },
      workUnit: {},
    }),
    now: () => NOW,
    ...over,
  };
}

describe("robin recovery dispatch", () => {
  it("default off (real default): no scan, no submit", async () => {
    const d = deps({
      listRecoveryDeployments: vi.fn().mockResolvedValue([
        { organizationId: "org_1", governanceConfig: null }, // unconfigured -> resolveRecoveryConfig -> off
        { organizationId: "org_2", governanceConfig: { recovery: { mode: "off" } } },
      ]),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.findNoShowCandidates).not.toHaveBeenCalled();
    expect(d.submitRecoveryCampaign).not.toHaveBeenCalled();
    expect(out).toMatchObject({ orgsEnforced: 0, orgsObserved: 0, campaignsParked: 0 });
  });

  it("observe: assembles the cohort and counts candidates, but never submits", async () => {
    const d = deps({
      listRecoveryDeployments: vi
        .fn()
        .mockResolvedValue([
          { organizationId: "org_1", governanceConfig: { recovery: { mode: "observe" } } },
        ]),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.findNoShowCandidates).toHaveBeenCalledWith("org_1", WINDOW_FROM, NOW); // [now-14d, now]
    expect(d.submitRecoveryCampaign).not.toHaveBeenCalled();
    expect(out).toMatchObject({ orgsObserved: 1, candidatesObserved: 1, campaignsParked: 0 });
  });

  it("enforce: submits ONE campaign with asOf=now and records it parked", async () => {
    const d = deps();
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.submitRecoveryCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        asOf: NOW,
        windowFrom: WINDOW_FROM,
        windowTo: NOW,
        candidates: [expect.objectContaining({ bookingId: "bk_1" })],
      }),
    );
    expect(out).toMatchObject({ orgsEnforced: 1, campaignsParked: 1, failed: 0 });
  });

  it("enforce: excludes self-rebooked contacts from the cohort (rebooked-exclusion)", async () => {
    const d = deps({
      findNoShowCandidates: vi
        .fn()
        .mockResolvedValue([row(), row({ contactId: "ct_2", bookingId: "bk_2" })]),
      findFutureBookingContactIds: vi.fn().mockResolvedValue(new Set(["ct_2"])),
    });
    await executeRobinRecoveryDispatch(step, d as never);
    const submitted = (d.submitRecoveryCampaign as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      candidates: Array<{ contactId: string }>;
    };
    expect(submitted.candidates.map((c) => c.contactId)).toEqual(["ct_1"]);
  });

  it("enforce + empty cohort: never submits (an empty campaign must not park)", async () => {
    const d = deps({ findNoShowCandidates: vi.fn().mockResolvedValue([]) });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.submitRecoveryCampaign).not.toHaveBeenCalled();
    expect(out).toMatchObject({ orgsEnforced: 1, campaignsParked: 0 });
  });

  it("enforce: idempotency_in_flight is a safe skip, not a failure", async () => {
    const d = deps({
      submitRecoveryCampaign: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { type: "idempotency_in_flight" } }),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(out).toMatchObject({ skipped: 1, failed: 0, campaignsParked: 0 });
  });

  it("enforce: a non-park failure (e.g. governance deny) is recorded failed, nothing sent", async () => {
    const d = deps({
      submitRecoveryCampaign: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { type: "governance_denied" } }),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(out).toMatchObject({ failed: 1, campaignsParked: 0 });
  });

  it("reduces multiple deployments of one org to a single enforce action (enforce > observe)", async () => {
    const d = deps({
      listRecoveryDeployments: vi.fn().mockResolvedValue([
        { organizationId: "org_1", governanceConfig: { recovery: { mode: "observe" } } },
        { organizationId: "org_1", governanceConfig: { recovery: { mode: "enforce" } } },
      ]),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.findNoShowCandidates).toHaveBeenCalledTimes(1); // one org, one scan
    expect(d.submitRecoveryCampaign).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ deploymentsScanned: 2, orgsEnforced: 1 });
  });
});
