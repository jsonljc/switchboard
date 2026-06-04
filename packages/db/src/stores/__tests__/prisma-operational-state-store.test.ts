import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOperationalStateStore } from "../prisma-operational-state-store.js";
import type { OperationalState } from "@switchboard/schemas";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "osc_1",
    organizationId: "org_1",
    operatingStatus: "open",
    staffing: null,
    inventory: null,
    promoWindows: null,
    closures: null,
    note: null,
    confirmedBy: null,
    confirmedAt: new Date("2026-06-03T10:00:00.000Z"),
    createdAt: new Date("2026-06-03T10:00:00.000Z"),
    ...overrides,
  };
}

function makePrisma() {
  return {
    operationalStateConfirmation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("PrismaOperationalStateStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaOperationalStateStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaOperationalStateStore(prisma as never);
  });

  describe("recordConfirmation", () => {
    it("inserts a validated confirmation and omits unconfirmed dimensions entirely", async () => {
      const confirmedAt = new Date("2026-06-04T09:00:00.000Z");
      prisma.operationalStateConfirmation.create.mockResolvedValue(
        makeRow({
          id: "osc_9",
          operatingStatus: null,
          staffing: "shortfall",
          confirmedBy: "user_7",
          confirmedAt,
          createdAt: confirmedAt,
        }),
      );
      const state: OperationalState = { staffing: "shortfall" };
      const got = await store.recordConfirmation("org_1", state, {
        confirmedBy: "user_7",
        confirmedAt,
      });
      // Unconfirmed dimensions are ABSENT from the insert (columns default to
      // NULL = unconfirmed), never written as fabricated "open"/"normal".
      expect(prisma.operationalStateConfirmation.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org_1",
          staffing: "shortfall",
          confirmedBy: "user_7",
          confirmedAt,
        },
      });
      expect(got.state).toEqual({ staffing: "shortfall" });
      expect(got.confirmedAt).toEqual(confirmedAt);
      expect(got.confirmedBy).toBe("user_7");
    });

    it("rejects an invalid state without touching the database", async () => {
      await expect(
        store.recordConfirmation(
          "org_1",
          { operatingStatus: "closed" } as unknown as OperationalState,
          { confirmedAt: new Date("2026-06-04T09:00:00.000Z") },
        ),
      ).rejects.toThrow();
      expect(prisma.operationalStateConfirmation.create).not.toHaveBeenCalled();
    });

    it("rejects an empty confirmation (no fabricated freshness from contentless rows)", async () => {
      await expect(
        store.recordConfirmation("org_1", {} as unknown as OperationalState, {
          confirmedAt: new Date("2026-06-04T09:00:00.000Z"),
        }),
      ).rejects.toThrow();
      expect(prisma.operationalStateConfirmation.create).not.toHaveBeenCalled();
    });

    it("rejects a note-only confirmation (a note alone must not create freshness)", async () => {
      await expect(
        store.recordConfirmation("org_1", { note: "all quiet" } as unknown as OperationalState, {
          confirmedAt: new Date("2026-06-04T09:00:00.000Z"),
        }),
      ).rejects.toThrow();
      expect(prisma.operationalStateConfirmation.create).not.toHaveBeenCalled();
    });

    it("writes an explicit empty array (operator confirmed none), distinct from omitting the column", async () => {
      const confirmedAt = new Date("2026-06-04T09:00:00.000Z");
      prisma.operationalStateConfirmation.create.mockResolvedValue(
        makeRow({
          id: "osc_10",
          operatingStatus: null,
          promoWindows: [],
          confirmedAt,
          createdAt: confirmedAt,
        }),
      );
      const got = await store.recordConfirmation("org_1", { promoWindows: [] }, { confirmedAt });
      // [] is a confirmation ("no promos running"); it must reach the insert
      // as [] (a NOT NULL jsonb that satisfies the nonempty-state CHECK),
      // never be dropped to an omitted/NULL column (= unconfirmed).
      expect(prisma.operationalStateConfirmation.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org_1",
          promoWindows: [],
          confirmedAt,
        },
      });
      expect(got.state).toEqual({ promoWindows: [] });
    });
  });

  describe("getLatest", () => {
    it("returns null when the org has no confirmations (honest absence, not a default)", async () => {
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(null);
      expect(await store.getLatest("org_legacy")).toBeNull();
      // Tiebreak rule pinned: confirmedAt, then createdAt, then id. CUID
      // lexical order is not a semantic action order, so createdAt sits
      // before id; id only makes the ordering total.
      expect(prisma.operationalStateConfirmation.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org_legacy" },
        orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
    });

    it("reconstructs the typed state from a row, omitting NULL dimensions", async () => {
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({
          promoWindows: [{ start: "2026-06-01T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        }),
      );
      const got = await store.getLatest("org_1");
      expect(got?.state).toEqual({
        operatingStatus: "open",
        promoWindows: [{ start: "2026-06-01T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
      });
      expect(Object.prototype.hasOwnProperty.call(got?.state ?? {}, "staffing")).toBe(false);
    });

    it("degrades a note-only row (all operational dimensions NULL) to absence on read", async () => {
      // Defense-in-depth: the DB nonempty_state CHECK forbids inserting such
      // a row, but if one ever reached the table (constraint dropped, dump
      // restore), the read path must still refuse to surface it as a
      // freshness anchor.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({ operatingStatus: null, note: "sneaky note" }),
      );
      expect(await store.getLatest("org_1")).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("degrades a malformed latest row to absence with a warning and does NOT fall back to an older row", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({ operatingStatus: "permanently_closed" }),
      );
      expect(await store.getLatest("org_1")).toBeNull();
      expect(warn).toHaveBeenCalled();
      // Single query, honest null: falling back to an older valid row would
      // claim older knowledge as current and overstate freshness.
      expect(prisma.operationalStateConfirmation.findFirst).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe("getConfirmationsOverlappingWindow", () => {
    it("returns the governing confirmation plus in-window confirmations for a past window, oldest first", async () => {
      // The 4c contract: the outcome cron runs AFTER the attribution window
      // closes. The May 20 confirmation governs entry into the June 1-7
      // window (derived validity [May 20, June 3)); June 3 is a mid-window
      // regime change. Anything confirmed after windowEnd is excluded by the
      // query predicates pinned below.
      const windowStart = new Date("2026-06-01T00:00:00.000Z");
      const windowEnd = new Date("2026-06-07T23:59:59.000Z");
      const may20 = makeRow({
        id: "may20",
        confirmedAt: new Date("2026-05-20T08:00:00.000Z"),
        createdAt: new Date("2026-05-20T08:00:00.000Z"),
      });
      const june3 = makeRow({
        id: "june3",
        operatingStatus: null,
        promoWindows: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        confirmedAt: new Date("2026-06-03T09:00:00.000Z"),
        createdAt: new Date("2026-06-03T09:00:00.000Z"),
      });
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(may20);
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([june3]);

      const got = await store.getConfirmationsOverlappingWindow("org_1", windowStart, windowEnd);

      expect(prisma.operationalStateConfirmation.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org_1", confirmedAt: { lte: windowStart } },
        orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      expect(prisma.operationalStateConfirmation.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_1", confirmedAt: { gt: windowStart, lte: windowEnd } },
        orderBy: [{ confirmedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      expect(got.map((c) => c.id)).toEqual(["may20", "june3"]);
    });

    it("keeps same-confirmedAt rows in (createdAt, id) order: the later row supersedes at that instant", async () => {
      const at = new Date("2026-06-03T09:00:00.000Z");
      const first = makeRow({
        id: "a",
        confirmedAt: at,
        createdAt: new Date("2026-06-03T09:00:00.100Z"),
      });
      const second = makeRow({
        id: "b",
        operatingStatus: "temporarily_closed",
        confirmedAt: at,
        createdAt: new Date("2026-06-03T09:00:00.200Z"),
      });
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(null);
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([first, second]);
      const got = await store.getConfirmationsOverlappingWindow(
        "org_1",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-07T00:00:00.000Z"),
      );
      // Consumers reading the stream in order land on "b" as the superseding
      // state at the shared instant; "a" has a zero-length derived validity
      // interval, which is acceptable and documented.
      expect(got.map((c) => c.id)).toEqual(["a", "b"]);
      expect(got[1]?.state).toEqual({ operatingStatus: "temporarily_closed" });
    });

    it("skips a malformed governing row but keeps valid in-window rows", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({ id: "bad-governing", inventory: "plenty" }),
      );
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([
        makeRow({ id: "good-in-window", confirmedAt: new Date("2026-06-03T09:00:00.000Z") }),
      ]);
      const got = await store.getConfirmationsOverlappingWindow(
        "org_1",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-07T00:00:00.000Z"),
      );
      expect(got.map((c) => c.id)).toEqual(["good-in-window"]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("returns [] when nothing governs or falls inside the window (unknown, not stable)", async () => {
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(null);
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([]);
      const got = await store.getConfirmationsOverlappingWindow(
        "org_legacy",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-07T00:00:00.000Z"),
      );
      expect(got).toEqual([]);
    });

    it("skips malformed rows instead of surfacing fabricated state", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({ inventory: "plenty" }),
      );
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([]);
      const got = await store.getConfirmationsOverlappingWindow(
        "org_1",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-07T00:00:00.000Z"),
      );
      expect(got).toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
