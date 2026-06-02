import { describe, expect, it } from "vitest";
import { buildNextCadenceTouch } from "./cadence.js";
import type { DueScheduledFollowUp } from "./scheduled-follow-up-store.js";

const NOW = new Date("2026-06-04T00:00:00.000Z");
function row(overrides: Partial<DueScheduledFollowUp> = {}): DueScheduledFollowUp {
  return {
    id: "fu_1",
    organizationId: "org_1",
    contactId: "c_1",
    conversationThreadId: "th_1",
    sessionId: "th_1",
    deploymentId: "dep_1",
    workUnitId: "wu_1",
    channel: "whatsapp",
    jurisdiction: "SG",
    reason: "hesitation",
    note: null,
    templateIntentClass: "re-engagement-offer",
    attempts: 0,
    dueAt: new Date("2026-06-02T00:00:00.000Z"),
    touchNumber: 1,
    cadenceId: "cad_1",
    ...overrides,
  };
}

describe("buildNextCadenceTouch", () => {
  it("touch 1 → touch 2 at now+3d with inherited fields", () => {
    const next = buildNextCadenceTouch(row(), NOW);
    expect(next).not.toBeNull();
    expect(next!.touchNumber).toBe(2);
    expect(next!.cadenceId).toBe("cad_1");
    expect(next!.dueAt).toEqual(new Date("2026-06-07T00:00:00.000Z"));
    expect(next!.dedupeKey).toBe("followup:org_1:c_1:2026-06-07:t2");
    expect(next!.deploymentId).toBe("dep_1");
    expect(next!.templateIntentClass).toBe("re-engagement-offer");
  });

  it("touch 2 → touch 3 at now+7d", () => {
    const next = buildNextCadenceTouch(row({ touchNumber: 2 }), NOW);
    expect(next!.touchNumber).toBe(3);
    expect(next!.dueAt).toEqual(new Date("2026-06-11T00:00:00.000Z"));
    expect(next!.dedupeKey).toBe("followup:org_1:c_1:2026-06-11:t3");
  });

  it("touch 3 → null (cadence complete)", () => {
    expect(buildNextCadenceTouch(row({ touchNumber: 3 }), NOW)).toBeNull();
  });

  it("legacy row (cadenceId null) → null (never advances)", () => {
    expect(buildNextCadenceTouch(row({ cadenceId: null }), NOW)).toBeNull();
  });
});
