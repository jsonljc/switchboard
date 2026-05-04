import { describe, expect, it } from "vitest";
import { mapToDecisionCard } from "../map-to-decision-card.js";
import type { Decision } from "../types.js";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "approval:rec-1",
    kind: "approval",
    agentKey: "alex",
    humanSummary: "Should I send Maya the membership comparison?",
    presentation: {
      primaryLabel: "Yes, send it",
      secondaryLabel: "Not yet",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    urgencyScore: 78,
    createdAt: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(),
    threadHref: "/contacts/maya/conversations",
    sourceRef: { kind: "approval", sourceId: "rec-1" },
    meta: { contactName: "Maya R." },
    ...overrides,
  };
}

describe("mapToDecisionCard", () => {
  it("composes the folio kindLabel with the index", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.folio.kindLabel).toBe("DECISION 1");
  });

  it("composes a HANDOFF kindLabel for handoff kind", () => {
    const props = mapToDecisionCard(
      makeDecision({ kind: "handoff", sourceRef: { kind: "handoff", sourceId: "h-1" } }),
      0,
    );
    expect(props.folio.kindLabel).toBe("HANDOFF 1");
  });

  it("includes contact name in the right folio", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.folio.rightFolio).toContain("MAYA R.");
  });

  it("uses '—' when contactName missing", () => {
    const props = mapToDecisionCard(makeDecision({ meta: {} }), 0);
    expect(props.folio.rightFolio).toContain("—");
  });

  it("passes pill labels through unchanged", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.primaryLabel).toBe("Yes, send it");
    expect(props.secondaryLabel).toBe("Not yet");
    expect(props.dismissLabel).toBe("Dismiss");
  });

  it("passes threadHref through", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.threadHref).toBe("/contacts/maya/conversations");
  });

  it("preserves source for action dispatch", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.source).toEqual({ kind: "approval", sourceId: "rec-1" });
  });

  it("handoff right folio mentions DUE for SLA", () => {
    const slaIso = new Date(Date.now() + 4 * 3_600_000).toISOString();
    const props = mapToDecisionCard(
      makeDecision({
        kind: "handoff",
        sourceRef: { kind: "handoff", sourceId: "h-1" },
        meta: { contactName: "Priya M.", slaDeadlineAt: slaIso },
      }),
      0,
    );
    expect(props.folio.rightFolio).toContain("DUE");
  });
});
