import { describe, it, expect } from "vitest";
import { mergeRileyActivityAndOutcomes } from "../merge-riley-outcomes";
import type { ActivityRow } from "@switchboard/schemas";

const activity: ActivityRow[] = [
  {
    id: "a-1",
    time: "11:42",
    timestampIso: "2026-05-01T11:42:00Z",
    kind: "paused",
    head: "Paused Low-CPL summer campaign.",
  },
];

const outcomes: ActivityRow[] = [
  {
    id: "outcome:o-1",
    time: "07:00",
    timestampIso: "2026-05-08T07:00:00Z",
    kind: "observed",
    head: "Spend fell 92.0% in 7d after pause.",
  },
];

describe("mergeRileyActivityAndOutcomes", () => {
  it("merges and sorts descending by timestampIso", () => {
    const merged = mergeRileyActivityAndOutcomes(activity, outcomes);
    expect(merged.map((r) => r.id)).toEqual(["outcome:o-1", "a-1"]);
  });

  it("preserves order when timestamps are equal (stable sort)", () => {
    const a: ActivityRow = {
      id: "a-eq",
      time: "07:00",
      timestampIso: "2026-05-08T07:00:00Z",
      kind: "paused",
      head: "Some activity.",
    };
    const o: ActivityRow = {
      id: "outcome:o-eq",
      time: "07:00",
      timestampIso: "2026-05-08T07:00:00Z",
      kind: "observed",
      head: "Some outcome.",
    };
    const merged = mergeRileyActivityAndOutcomes([a], [o]);
    expect(merged.map((r) => r.id)).toEqual(["a-eq", "outcome:o-eq"]);
  });

  it("returns activity-only rows when outcomes is empty", () => {
    const merged = mergeRileyActivityAndOutcomes(activity, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("a-1");
  });

  it("returns outcome-only rows when activity is empty", () => {
    const merged = mergeRileyActivityAndOutcomes([], outcomes);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("outcome:o-1");
  });

  it("handles rows without timestampIso by sorting them to the end", () => {
    const noTs: ActivityRow = { id: "no-ts", time: "05:00", kind: "watching", head: "Watching." };
    const withTs: ActivityRow = {
      id: "with-ts",
      time: "12:00",
      timestampIso: "2026-05-01T12:00:00Z",
      kind: "paused",
      head: "Paused.",
    };
    const merged = mergeRileyActivityAndOutcomes([noTs], [withTs]);
    expect(merged.map((r) => r.id)).toEqual(["with-ts", "no-ts"]);
  });

  it("returns empty array when both inputs are empty", () => {
    expect(mergeRileyActivityAndOutcomes([], [])).toEqual([]);
  });
});
