// apps/dashboard/src/hooks/__tests__/use-cockpit-status.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { deriveAlexStatusA1, useCockpitStatusAlex } from "../use-cockpit-status";

const NOW = new Date("2026-05-14T12:00:00Z");

describe("deriveAlexStatusA1", () => {
  it("returns HALTED when halted is true regardless of other inputs", () => {
    expect(
      deriveAlexStatusA1({
        halted: true,
        pendingApprovals: 5,
        recentActivityAt: NOW,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("HALTED");
  });

  it("returns WAITING when one or more approvals are pending", () => {
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 1,
        recentActivityAt: null,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("WAITING");
  });

  it("returns WORKING when recent activity exists within the 15-minute window", () => {
    const recent = new Date("2026-05-14T11:50:00Z");
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 0,
        recentActivityAt: recent,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("WORKING");
  });

  it("returns IDLE when activity is older than 15 minutes", () => {
    const old = new Date("2026-05-14T11:30:00Z");
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 0,
        recentActivityAt: old,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("IDLE");
  });

  it("returns IDLE when there is no recent activity", () => {
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 0,
        recentActivityAt: null,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("IDLE");
  });

  it("returns IDLE even when in quiet hours (no WORKING signal)", () => {
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 0,
        recentActivityAt: null,
        inQuietHours: true,
        now: NOW,
      }),
    ).toBe("IDLE");
  });

  it("prioritizes HALTED over WAITING", () => {
    expect(
      deriveAlexStatusA1({
        halted: true,
        pendingApprovals: 3,
        recentActivityAt: null,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("HALTED");
  });

  it("prioritizes WAITING over WORKING", () => {
    const recent = new Date("2026-05-14T11:55:00Z");
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 1,
        recentActivityAt: recent,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("WAITING");
  });
});

describe("useCockpitStatusAlex", () => {
  it("re-derives when `now` changes (drives WORKING → IDLE transition)", () => {
    const recentActivityAt = new Date("2026-05-14T12:00:00Z");
    const insideWindow = new Date("2026-05-14T12:10:00Z"); // 10 min after activity
    const outsideWindow = new Date("2026-05-14T12:20:00Z"); // 20 min after activity

    const { result, rerender } = renderHook(
      ({ now }: { now: Date }) =>
        useCockpitStatusAlex({
          halted: false,
          pendingApprovals: 0,
          recentActivityAt,
          now,
        }),
      { initialProps: { now: insideWindow } },
    );

    expect(result.current).toBe("WORKING");

    rerender({ now: outsideWindow });
    expect(result.current).toBe("IDLE");
  });
});
