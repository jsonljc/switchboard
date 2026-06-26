import { describe, it, expect, vi } from "vitest";
import {
  reapOrphanedRecoveryClaims,
  ROBIN_RECOVERY_ORPHAN_MAX_AGE_MS,
  ROBIN_RECOVERY_ORPHAN_REAP_LIMIT,
  type OrphanedClaimReaperStore,
  type OrphanedRobinRecoverySend,
} from "./reap-orphaned-recovery-claims.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");
const OLDER_THAN = new Date(NOW.getTime() - ROBIN_RECOVERY_ORPHAN_MAX_AGE_MS);

function makeOrphan(over: Partial<OrphanedRobinRecoverySend> = {}): OrphanedRobinRecoverySend {
  return {
    id: "rrs_1",
    organizationId: "org_1",
    contactId: "ct_1",
    bookingId: "bk_1",
    updatedAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h ago: comfortably stale
    ...over,
  };
}

function makeStore(over: Partial<OrphanedClaimReaperStore> = {}): OrphanedClaimReaperStore {
  return {
    findOrphanedClaims: vi.fn().mockResolvedValue([]),
    reapOrphanedClaim: vi.fn().mockResolvedValue({ count: 1 }),
    ...over,
  };
}

function run(store: OrphanedClaimReaperStore) {
  return reapOrphanedRecoveryClaims(
    { store, now: () => NOW },
    { olderThanMs: ROBIN_RECOVERY_ORPHAN_MAX_AGE_MS, limit: ROBIN_RECOVERY_ORPHAN_REAP_LIMIT },
  );
}

describe("reapOrphanedRecoveryClaims", () => {
  it("scans with (now - olderThanMs, limit) and returns zeros when nothing is orphaned", async () => {
    const store = makeStore();
    const r = await run(store);
    expect(store.findOrphanedClaims).toHaveBeenCalledWith(
      OLDER_THAN,
      ROBIN_RECOVERY_ORPHAN_REAP_LIMIT,
    );
    expect(r).toEqual({ scanned: 0, reaped: 0, raced: 0, failed: 0 });
  });

  it("dead-letters a found orphan via the status-CAS (count 1) and counts it reaped", async () => {
    const store = makeStore({ findOrphanedClaims: vi.fn().mockResolvedValue([makeOrphan()]) });
    const r = await run(store);
    // RED-TEST (1): a stale orphan is detected and safely handled (dead-lettered), not left invisible.
    // The CAS is org-scoped and handed the same olderThan as the scan, so the reap re-asserts both the
    // owning org and the staleness guard.
    expect(store.reapOrphanedClaim).toHaveBeenCalledWith("rrs_1", "org_1", OLDER_THAN);
    expect(r).toEqual({ scanned: 1, reaped: 1, raced: 0, failed: 0 });
  });

  it("CAS count===0 (a concurrent live sender or reaper won the row) is a benign race, never a re-send", async () => {
    // RED-TEST (3): the guarded status-CAS prevents two concurrent reapers (or a reaper + live
    // sender) from both winning the row. count===0 means someone else terminalized it first ->
    // skip, do NOT re-handle and (critically) never trigger a send.
    const store = makeStore({
      findOrphanedClaims: vi.fn().mockResolvedValue([makeOrphan()]),
      reapOrphanedClaim: vi.fn().mockResolvedValue({ count: 0 }),
    });
    const r = await run(store);
    expect(r).toEqual({ scanned: 1, reaped: 0, raced: 1, failed: 0 });
  });

  it("isolates a CAS throw so one bad row never aborts the rest of the sweep", async () => {
    const store = makeStore({
      findOrphanedClaims: vi
        .fn()
        .mockResolvedValue([makeOrphan({ id: "bad" }), makeOrphan({ id: "good" })]),
      reapOrphanedClaim: vi
        .fn()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce({ count: 1 }),
    });
    const r = await run(store);
    expect(r).toEqual({ scanned: 2, reaped: 1, raced: 0, failed: 1 });
  });

  it("a scan throw propagates (a sweep that cannot read must be visible to the cron onFailure)", async () => {
    const store = makeStore({
      findOrphanedClaims: vi.fn().mockRejectedValue(new Error("scan failed")),
    });
    await expect(run(store)).rejects.toThrow("scan failed");
  });

  it("exposes the 30-minute staleness threshold and 500-row cap as code constants (no env var)", () => {
    expect(ROBIN_RECOVERY_ORPHAN_MAX_AGE_MS).toBe(30 * 60 * 1000);
    expect(ROBIN_RECOVERY_ORPHAN_REAP_LIMIT).toBe(500);
  });
});
