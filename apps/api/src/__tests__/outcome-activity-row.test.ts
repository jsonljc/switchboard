/**
 * Unit tests for the shared RecommendationOutcomeReadModel → ActivityRow
 * translator (extracted from the dedicated outcomes route in slice 3 so the
 * cockpit activity feed can reuse it). Pins the trust-signal suffix and the
 * legacy-null honesty floor: rows predating slice 3 render byte-identically
 * to the pre-slice-3 output.
 */
import { describe, it, expect } from "vitest";
import { translateOutcomeToActivityRow } from "../lib/outcome-activity-row.js";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";

const BASE: RecommendationOutcomeReadModel = {
  id: "outcome-1",
  recommendationId: "rec-1",
  actionKind: "pause",
  windowEndedAt: new Date("2026-05-08T12:00:00Z"),
  copyTemplate: "pause.spend.fell",
  copyValues: { deltaPct: -92, windowDays: 7 },
  campaignId: "camp-A",
  campaignName: "Campaign A",
  causalStrength: "directional",
  businessContextStable: "unknown",
  trustDelta: "up",
};

describe("translateOutcomeToActivityRow", () => {
  it("translates a renderable row to an observed ActivityRow with the trust-signal suffix in head", () => {
    const row = translateOutcomeToActivityRow(BASE);
    expect(row).toMatchObject({
      id: "outcome:outcome-1",
      kind: "observed",
      head: "Spend fell 92.0% in 7d after pause. This outcome is a positive signal for this action.",
      body: "after pause · Campaign A",
      time: "12:00",
      timestampIso: "2026-05-08T12:00:00.000Z",
    });
  });

  it("renders the negative-signal suffix for trustDelta down", () => {
    const row = translateOutcomeToActivityRow({
      ...BASE,
      copyTemplate: "pause.spend.changed",
      copyValues: { deltaPct: 10, windowDays: 7 },
      trustDelta: "down",
    });
    expect(row?.head).toBe(
      "Spend changed 10.0% in 7d after pause. This outcome is a negative signal for this action.",
    );
  });

  it("renders legacy rows (trustDelta null) byte-identically to pre-slice-3 output", () => {
    const row = translateOutcomeToActivityRow({ ...BASE, trustDelta: null });
    expect(row?.head).toBe("Spend fell 92.0% in 7d after pause.");
  });

  it("renders no suffix for trustDelta none (defensive: recorded, never displayed)", () => {
    const row = translateOutcomeToActivityRow({ ...BASE, trustDelta: "none" });
    expect(row?.head).toBe("Spend fell 92.0% in 7d after pause.");
  });

  it("fail-closes on off-allowlist copy templates", () => {
    expect(
      translateOutcomeToActivityRow({ ...BASE, copyTemplate: "pause.spend.exploded" }),
    ).toBeNull();
  });

  it("fail-closes when copyTemplate or copyValues are missing", () => {
    expect(translateOutcomeToActivityRow({ ...BASE, copyTemplate: null })).toBeNull();
    expect(translateOutcomeToActivityRow({ ...BASE, copyValues: null })).toBeNull();
  });

  it("renders a corroborated row byte-identically to its directional twin (causalStrength is not operator copy; riley v3 slice 4d)", () => {
    const directional = translateOutcomeToActivityRow(BASE);
    const corroborated = translateOutcomeToActivityRow({
      ...BASE,
      causalStrength: "corroborated",
    });
    expect(corroborated).toEqual(directional);
  });
});
