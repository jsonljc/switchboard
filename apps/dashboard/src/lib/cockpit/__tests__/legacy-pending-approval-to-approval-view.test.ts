// apps/dashboard/src/lib/cockpit/__tests__/legacy-pending-approval-to-approval-view.test.ts
import { describe, it, expect } from "vitest";
import { legacyPendingApprovalToApprovalView } from "../legacy-pending-approval-to-approval-view.js";
import type { PendingApproval } from "@/lib/api-client-types";

const NOW = new Date("2026-05-14T12:00:00Z");

function makePending(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "appr_1",
    summary: "Send Jordan the founding-member rate?",
    riskCategory: "medium",
    status: "pending",
    envelopeId: "env_1",
    expiresAt: "2026-05-14T13:00:00Z",
    bindingHash: "hash_abc",
    createdAt: "2026-05-14T11:56:00Z",
    ...overrides,
  };
}

describe("legacyPendingApprovalToApprovalView", () => {
  it("maps a low-risk pricing approval to this_week urgency with respond action", () => {
    const view = legacyPendingApprovalToApprovalView(makePending({ riskCategory: "low" }), NOW);
    expect(view.urgency).toBe("this_week");
    expect(view.title).toBe("Send Jordan the founding-member rate?");
    expect(view.askedAt).toBe("4 min ago");
    expect(view.primaryAction).toEqual({
      kind: "respond",
      bindingHash: "hash_abc",
      verdict: "accept",
    });
    expect(view.kind).toBe("pricing");
  });

  it("maps a high-risk approval to immediate urgency", () => {
    const view = legacyPendingApprovalToApprovalView(makePending({ riskCategory: "high" }), NOW);
    expect(view.urgency).toBe("immediate");
  });

  it("maps a critical-risk approval to immediate urgency", () => {
    const view = legacyPendingApprovalToApprovalView(
      makePending({ riskCategory: "critical" }),
      NOW,
    );
    expect(view.urgency).toBe("immediate");
  });

  it("carries the binding hash and id through to the view", () => {
    const view = legacyPendingApprovalToApprovalView(
      makePending({ id: "appr_xyz", bindingHash: "hash_xyz" }),
      NOW,
    );
    expect(view.id).toBe("appr_xyz");
    if (view.primaryAction.kind === "respond") {
      expect(view.primaryAction.bindingHash).toBe("hash_xyz");
    }
  });

  it("populates presentation primary/secondary labels with defaults", () => {
    const view = legacyPendingApprovalToApprovalView(makePending(), NOW);
    expect(view.primary).toBe("Accept");
    expect(view.secondary).toBe("Decline");
    expect(view.presentation).toEqual({ primaryLabel: "Accept", dismissLabel: "Decline" });
  });
});
