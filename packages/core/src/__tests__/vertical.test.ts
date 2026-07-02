import { describe, it, expect } from "vitest";
import { DEFAULT_VERTICAL, resolveVerticalTable, type Vertical } from "../vertical.js";

describe("vertical", () => {
  it("defaults to the medspa seed vertical (keeps existing behavior byte-identical)", () => {
    // The compile-time annotation is the real guarantee that DEFAULT_VERTICAL is a
    // Vertical member; the runtime assertion pins the seed value the loaders/scorer
    // key on. tsc enforces the union across every consumer, so no runtime list is
    // duplicated here (which would silently drift from the union).
    const seed: Vertical = DEFAULT_VERTICAL;
    expect(seed).toBe("medspa");
  });
});

describe("resolveVerticalTable", () => {
  const floor: ReadonlyArray<{ id: string }> = [{ id: "floor-a" }, { id: "floor-b" }];

  it("returns a registered non-empty table verbatim (identity, byte-identical resolution)", () => {
    const medspa: ReadonlyArray<{ id: string }> = [{ id: "m1" }];
    const byVertical: Partial<Record<Vertical, ReadonlyArray<{ id: string }>>> = { medspa };
    expect(resolveVerticalTable(byVertical, "medspa", floor)).toBe(medspa);
  });

  it("falls back to the floor for an absent vertical", () => {
    const byVertical: Partial<Record<Vertical, ReadonlyArray<{ id: string }>>> = {
      medspa: [{ id: "m1" }],
    };
    expect(resolveVerticalTable(byVertical, "fitness", floor)).toBe(floor);
  });

  it("falls back to the floor for an EMPTY registered table (closes the empty-array fail-open)", () => {
    const byVertical: Partial<Record<Vertical, ReadonlyArray<{ id: string }>>> = { fitness: [] };
    // A `?? floor` form would return the empty array here (empty is not nullish);
    // the length check must fail CLOSED to the floor instead.
    expect(resolveVerticalTable(byVertical, "fitness", floor)).toBe(floor);
  });
});
