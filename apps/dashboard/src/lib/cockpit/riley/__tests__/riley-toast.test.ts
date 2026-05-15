import { describe, it, expect } from "vitest";
import { rileyToast } from "../riley-toast";
import type { RileyApprovalView, RileyApprovalKind } from "@/components/cockpit/types";

const baseView = (overrides: Partial<RileyApprovalView> = {}): RileyApprovalView => ({
  id: "rec-1",
  kind: "pause",
  urgency: "immediate",
  askedAt: "2m",
  title: "Pause Cold Interests",
  presentation: { primaryLabel: "Pause", dismissLabel: "Dismiss" },
  primary: "Pause",
  secondary: "Reduce 50%",
  campaign: { kind: "campaign", name: "Cold Interests", id: "c-1" },
  confidence: 0.9,
  learningPhaseImpact: "no impact",
  reversible: true,
  primaryAction: { kind: "internal", intent: "recommendation.pause", parameters: {} },
  ...overrides,
});

describe("rileyToast", () => {
  it("reads acceptToast verbatim when present", () => {
    const toast = rileyToast({
      verdict: "accept",
      approval: baseView({ acceptToast: "Paused Cold Interests. Standing by." }),
    });
    expect(toast.title).toBe("Paused Cold Interests. Standing by.");
  });

  it("reads declineToast verbatim when present", () => {
    const toast = rileyToast({
      verdict: "decline",
      approval: baseView({ declineToast: "Leaving Cold Interests running." }),
    });
    expect(toast.title).toBe("Leaving Cold Interests running.");
  });

  it("falls back to per-kind accept line when acceptToast is missing", () => {
    const toast = rileyToast({ verdict: "accept", approval: baseView({ kind: "scale" }) });
    expect(toast.title).toBe("Scaling — back to scanning.");
  });

  it("falls back to per-kind decline line when declineToast is missing", () => {
    const toast = rileyToast({ verdict: "decline", approval: baseView({ kind: "scale" }) });
    expect(toast.title).toBe("Holding — back to scanning.");
  });

  const FALLBACK_TABLE: Record<RileyApprovalKind, { accept: string; decline: string }> = {
    pause: { accept: "Paused — standing by.", decline: "Holding — back to scanning." },
    scale: { accept: "Scaling — back to scanning.", decline: "Holding — back to scanning." },
    refresh_creative: {
      accept: "Creative refresh queued — back to scanning.",
      decline: "Holding the current creative.",
    },
    restructure: {
      accept: "Restructure plan opened.",
      decline: "Holding the current structure.",
    },
    shift_budget_to_source: {
      accept: "Shifting budget — back to scanning.",
      decline: "Holding the current split.",
    },
    switch_optimization_event: {
      accept: "Switched optimization event.",
      decline: "Holding the current event.",
    },
    harden_capi_attribution: {
      accept: "Opening Meta to harden attribution.",
      decline: "Holding the current CAPI configuration.",
    },
    hold: { accept: "Holding — watching.", decline: "Acknowledged — back to scanning." },
    add_creative: {
      accept: "Add-creative ask routed.",
      decline: "Holding off on adding creatives.",
    },
    review_budget: {
      accept: "Opening Meta to review budget.",
      decline: "Holding the current budget.",
    },
    signal_health_group: {
      accept: "Opening Events Manager.",
      decline: "Acknowledged — back to scanning the pixel.",
    },
  };

  it.each(
    Object.entries(FALLBACK_TABLE) as Array<
      [RileyApprovalKind, { accept: string; decline: string }]
    >,
  )("fallback for kind %s renders the locked lines", (kind, lines) => {
    const accept = rileyToast({ verdict: "accept", approval: baseView({ kind }) });
    const decline = rileyToast({ verdict: "decline", approval: baseView({ kind }) });
    expect(accept.title).toBe(lines.accept);
    expect(decline.title).toBe(lines.decline);
  });

  it("treats empty-string acceptToast / declineToast as missing", () => {
    const accept = rileyToast({ verdict: "accept", approval: baseView({ acceptToast: "" }) });
    expect(accept.title).toBe("Paused — standing by.");
    const decline = rileyToast({ verdict: "decline", approval: baseView({ declineToast: "" }) });
    expect(decline.title).toBe("Holding — back to scanning.");
  });
});
