import { describe, it, expect } from "vitest";
import { translateRileyActivity } from "../riley-activity-translator";
import {
  watchingFixture,
  reviewingFixture,
  pausedFixture,
  scaledFixture,
  rotatedFixture,
  shiftedFixture,
  restructuredFixture,
  startedFixture,
  alertFixture,
  vocabularyDriftFixtures,
} from "../__fixtures__/riley-activity-fixtures";

describe("translateRileyActivity", () => {
  it("watching: system.daily_scan_completed → kind 'watching'", () => {
    const [row] = translateRileyActivity([watchingFixture]);
    expect(row.kind).toBe("watching");
  });

  it("reviewing: system.scoring_run_in_progress → kind 'reviewing'", () => {
    const [row] = translateRileyActivity([reviewingFixture]);
    expect(row.kind).toBe("reviewing");
  });

  it("paused: recommendation.pause + icon='success' → kind 'paused'", () => {
    const [row] = translateRileyActivity([pausedFixture]);
    expect(row.kind).toBe("paused");
  });

  it("scaled: recommendation.scale + icon='success' → kind 'scaled'", () => {
    const [row] = translateRileyActivity([scaledFixture]);
    expect(row.kind).toBe("scaled");
  });

  it("rotated: recommendation.refresh_creative + icon='success' → kind 'rotated'", () => {
    const [row] = translateRileyActivity([rotatedFixture]);
    expect(row.kind).toBe("rotated");
  });

  it("shifted: recommendation.shift_budget_to_source + icon='success' → kind 'shifted'", () => {
    const [row] = translateRileyActivity([shiftedFixture]);
    expect(row.kind).toBe("shifted");
  });

  it("restructured: recommendation.restructure + icon='success' → kind 'restructured'", () => {
    const [row] = translateRileyActivity([restructuredFixture]);
    expect(row.kind).toBe("restructured");
  });

  it("started: signal.learning_phase_active → kind 'started'", () => {
    const [row] = translateRileyActivity([startedFixture]);
    expect(row.kind).toBe("started");
  });

  it("alert: signal.connection_health_degraded → kind 'alert'", () => {
    const [row] = translateRileyActivity([alertFixture]);
    expect(row.kind).toBe("alert");
  });

  it("three-vocabulary intent drift: all three pause variants map to 'paused'", () => {
    const rows = translateRileyActivity(vocabularyDriftFixtures);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.kind).toBe("paused");
    }
  });

  it("unknown eventType falls back to 'watching' (graceful degradation)", () => {
    const unknown = { ...watchingFixture, eventType: "garbage.event.unknown" };
    const [row] = translateRileyActivity([unknown]);
    expect(row.kind).toBe("watching");
  });

  it("head is populated from text", () => {
    const [row] = translateRileyActivity([pausedFixture]);
    expect(row.head.length).toBeGreaterThan(0);
  });

  it("time is a relative-age string", () => {
    const [row] = translateRileyActivity([pausedFixture]);
    expect(typeof row.time).toBe("string");
    expect(row.time.length).toBeGreaterThan(0);
  });
});
