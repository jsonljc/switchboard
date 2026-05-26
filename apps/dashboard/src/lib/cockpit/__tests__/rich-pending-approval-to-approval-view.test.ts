// apps/dashboard/src/lib/cockpit/__tests__/rich-pending-approval-to-approval-view.test.ts
import { describe, it, expect } from "vitest";
import { richPendingApprovalToApprovalView } from "../rich-pending-approval-to-approval-view";
import type { PendingApproval } from "@/lib/api-client-types";
import { needsConfirm } from "@/lib/decisions/swipe-policy";

const NOW = new Date("2026-05-16T12:00:00.000Z");

function base(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "a1",
    summary: "Summary",
    riskCategory: "medium",
    status: "pending",
    envelopeId: "e1",
    expiresAt: "2026-05-17T12:00:00.000Z",
    bindingHash: "h1",
    createdAt: "2026-05-16T11:55:00.000Z",
    ...overrides,
  };
}

// Cockpit confirm-gate invariant (safety regression guard): AlexApprovalRow's
// accept gate reads `view.riskContract` and treats absence as unsafe
// (`needsConfirm` ⇒ true), forcing an explicit confirm before any commit. This
// adapter must never thread a contract that would re-open the one-tap path.
// Drives the gate from the REAL adapter output, not a hand-built view.
describe("richPendingApprovalToApprovalView — cockpit confirm-gate invariant", () => {
  it("never threads a risk contract that would bypass the cockpit confirm gate", () => {
    const kinds = [
      "pricing",
      "refund",
      "qualification",
      "regulatory",
      "safety-gate",
      "escalation",
    ] as const;
    for (const kind of kinds) {
      const view = richPendingApprovalToApprovalView(base({ kind }), NOW);
      expect(view.riskContract).toBeUndefined();
      expect(needsConfirm(view.riskContract)).toBe(true);
    }
  });
});

describe("richPendingApprovalToApprovalView — per-kind classification", () => {
  it("classifies kind='regulatory' as immediate with 'Edit reply' CTA", () => {
    const v = richPendingApprovalToApprovalView(
      base({ kind: "regulatory", riskCategory: "critical" }),
      NOW,
    );
    expect(v.kind).toBe("regulatory");
    expect(v.urgency).toBe("immediate");
    expect(v.primary).toBe("Edit reply");
  });

  it("classifies kind='safety-gate' as immediate with 'Edit reply' CTA", () => {
    const v = richPendingApprovalToApprovalView(
      base({ kind: "safety-gate", riskCategory: "critical" }),
      NOW,
    );
    expect(v.kind).toBe("safety-gate");
    expect(v.urgency).toBe("immediate");
    expect(v.primary).toBe("Edit reply");
  });

  it("classifies kind='refund' as immediate with 'Open thread' CTA", () => {
    const v = richPendingApprovalToApprovalView(base({ kind: "refund" }), NOW);
    expect(v.kind).toBe("refund");
    expect(v.urgency).toBe("immediate");
    expect(v.primary).toBe("Open thread");
  });

  it("classifies kind='escalation' as immediate with 'Open thread' CTA", () => {
    const v = richPendingApprovalToApprovalView(base({ kind: "escalation" }), NOW);
    expect(v.kind).toBe("escalation");
    expect(v.urgency).toBe("immediate");
    expect(v.primary).toBe("Open thread");
  });

  it("classifies kind='qualification' as this_week with 'Confirm disqualification' CTA", () => {
    const v = richPendingApprovalToApprovalView(base({ kind: "qualification" }), NOW);
    expect(v.kind).toBe("qualification");
    expect(v.urgency).toBe("this_week");
    expect(v.primary).toBe("Confirm disqualification");
  });

  it("classifies kind='pricing' with 'Accept & send' CTA, urgency from risk", () => {
    const v = richPendingApprovalToApprovalView(
      base({ kind: "pricing", riskCategory: "medium" }),
      NOW,
    );
    expect(v.kind).toBe("pricing");
    expect(v.primary).toBe("Accept & send");
    expect(v.urgency).toBe("this_week");
  });
});

describe("richPendingApprovalToApprovalView — payload forwarding", () => {
  it("forwards body/quote/quoteFrom when present", () => {
    const v = richPendingApprovalToApprovalView(
      base({
        kind: "regulatory",
        body: "Patient asked about FDA approval status.",
        quote: "Our laser treatment is FDA approved.",
        quoteFrom: "Alex (draft)",
      }),
      NOW,
    );
    expect(v.body).toBe("Patient asked about FDA approval status.");
    expect(v.quote).toBe("Our laser treatment is FDA approved.");
    expect(v.quoteFrom).toBe("Alex (draft)");
  });

  it("omits body/quote/quoteFrom when absent", () => {
    const v = richPendingApprovalToApprovalView(base({ kind: "regulatory" }), NOW);
    expect(v.body).toBeUndefined();
    expect(v.quote).toBeUndefined();
    expect(v.quoteFrom).toBeUndefined();
  });
});

describe("richPendingApprovalToApprovalView — legacy fallback", () => {
  it("falls back to legacy adapter when kind is absent (kind='pricing', default CTA 'Accept')", () => {
    const v = richPendingApprovalToApprovalView(base({}), NOW);
    expect(v.kind).toBe("pricing");
    // Legacy adapter uses "Accept"/"Decline" labels, not the spec's per-kind copy.
    expect(v.primary).toBe("Accept");
    expect(v.secondary).toBe("Decline");
  });

  it("falls back to legacy for high-risk legacy approval (kind='pricing', urgency='immediate')", () => {
    const v = richPendingApprovalToApprovalView(base({ riskCategory: "high" }), NOW);
    expect(v.kind).toBe("pricing");
    expect(v.urgency).toBe("immediate");
  });
});

describe("richPendingApprovalToApprovalView — core view shape", () => {
  it("carries id, askedAt, title, bindingHash through", () => {
    const v = richPendingApprovalToApprovalView(
      base({ id: "appr_xyz", kind: "regulatory", bindingHash: "hash_xyz" }),
      NOW,
    );
    expect(v.id).toBe("appr_xyz");
    expect(v.title).toBe("Summary");
    expect(v.askedAt).toBe("5 min ago");
    if (v.primaryAction.kind === "respond") {
      expect(v.primaryAction.bindingHash).toBe("hash_xyz");
    } else {
      // Should not happen for these kinds in v1; if it does we want the test to fail.
      expect.fail("Expected primaryAction.kind === 'respond'");
    }
  });

  it("primaryAction is 'respond' with verdict 'accept' for all six kinds", () => {
    const kinds: PendingApproval["kind"][] = [
      "pricing",
      "refund",
      "qualification",
      "regulatory",
      "safety-gate",
      "escalation",
    ];
    for (const kind of kinds) {
      const v = richPendingApprovalToApprovalView(base({ kind }), NOW);
      expect(v.primaryAction.kind).toBe("respond");
      if (v.primaryAction.kind === "respond") {
        expect(v.primaryAction.verdict).toBe("accept");
      }
    }
  });

  it("presentation primary/dismiss labels match primary/secondary", () => {
    const v = richPendingApprovalToApprovalView(base({ kind: "regulatory" }), NOW);
    expect(v.presentation.primaryLabel).toBe(v.primary);
    expect(v.presentation.dismissLabel).toBe(v.secondary);
  });
});
