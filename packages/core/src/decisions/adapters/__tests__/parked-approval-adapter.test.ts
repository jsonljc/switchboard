import { describe, it, expect } from "vitest";
import type { WorkTrace } from "../../../platform/work-trace.js";
import {
  adaptParkedApproval,
  adaptDegradedParkedApproval,
  type ParkedApprovalSummarizer,
} from "../parked-approval-adapter.js";

function makeTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: "wu-1",
    traceId: "trace-1",
    intent: "adoptimizer.recommendation.handoff",
    mode: "workflow",
    organizationId: "org_dev",
    actor: { id: "system", type: "system" },
    trigger: "internal",
    parameters: { campaignId: "camp-1", rationale: "CTR halved", apiToken: "sk-secret" },
    deploymentContext: {
      deploymentId: "dep-riley",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
    },
    governanceOutcome: "require_approval",
    riskScore: 0.4,
    matchedPolicies: [],
    outcome: "pending_approval",
    durationMs: 0,
    requestedAt: "2026-06-04T10:00:00.000Z",
    governanceCompletedAt: "2026-06-04T10:00:00.000Z",
    ingressPath: "platform_ingress",
    ...overrides,
  } as WorkTrace;
}

const lifecycle = {
  id: "lc-1",
  status: "pending",
  organizationId: "org_dev",
  expiresAt: new Date("2026-06-07T10:00:00.000Z"),
  createdAt: new Date("2026-06-04T10:00:00.000Z"),
};
const revision = { bindingHash: "hash-abc" };

describe("adaptParkedApproval", () => {
  it("builds a rich default card with a redacted parameter preview", () => {
    const d = adaptParkedApproval(lifecycle, revision, makeTrace());
    expect(d.kind).toBe("workflow_approval");
    expect(d.id).toBe("workflow_approval:lc-1");
    expect(d.sourceRef).toEqual({ kind: "workflow_approval", sourceId: "lc-1" });
    expect(d.agentKey).toBe("riley");
    expect(d.humanSummary).toContain("adoptimizer.recommendation.handoff");
    expect(d.meta.bindingHash).toBe("hash-abc");
    expect(d.meta.slaDeadlineAt).toEqual(lifecycle.expiresAt);
    const flat = (d.presentation.dataLines as Array<string | string[]>)
      .map((l) => (Array.isArray(l) ? l.join(" ") : l))
      .join("\n");
    expect(flat).toContain("system"); // actor
    expect(flat).toContain("internal"); // trigger
    expect(flat).toContain("campaignId"); // parameter preview key
    expect(flat).toContain("camp-1"); // primitive value shown
    expect(flat).not.toContain("sk-secret"); // redacted by key pattern
    expect(flat).toContain("No bespoke summary");
  });

  it("defaults UNKNOWN intents to a closed-toward-caution risk contract (review 14C)", () => {
    const d = adaptParkedApproval(lifecycle, revision, makeTrace());
    expect(d.meta.riskContract).toEqual({
      riskLevel: "high",
      externalEffect: true,
      financialEffect: false,
      clientFacing: true,
      requiresConfirmation: true,
    });
    expect(d.urgencyScore).toBeGreaterThanOrEqual(70);
  });

  it("applies a summarizer's card and risk contract", () => {
    const summarizer: ParkedApprovalSummarizer = (ctx) => ({
      humanSummary: `Riley wants to brief Mira on ${String(ctx.parameters["campaignId"])}.`,
      dataLines: ["Evidence: 1000 clicks"],
      presentation: { primaryLabel: "Approve handoff" },
      riskContract: {
        riskLevel: "medium",
        externalEffect: false,
        financialEffect: false,
        clientFacing: false,
        requiresConfirmation: true,
      },
    });
    const d = adaptParkedApproval(lifecycle, revision, makeTrace(), summarizer);
    expect(d.humanSummary).toBe("Riley wants to brief Mira on camp-1.");
    expect(d.presentation.primaryLabel).toBe("Approve handoff");
    expect(d.presentation.dataLines).toEqual(["Evidence: 1000 clicks"]);
    expect(d.meta.riskContract?.riskLevel).toBe("medium");
  });

  it("falls through to the default card when the summarizer returns null", () => {
    const d = adaptParkedApproval(lifecycle, revision, makeTrace(), () => null);
    expect(d.humanSummary).toContain("needs your approval");
  });

  it("renders a recovery card for recovery_required lifecycles", () => {
    const d = adaptParkedApproval(
      { ...lifecycle, status: "recovery_required" },
      revision,
      makeTrace(),
      () => ({ humanSummary: "Riley wants to brief Mira on camp-1." }),
    );
    expect(d.humanSummary).toMatch(/^Approved, but it didn't run: /);
    expect(d.presentation.primaryLabel).toBe("Retry");
    expect(d.meta.dispatchFailed).toBe(true);
    expect(d.urgencyScore).toBe(100);
  });

  it("attributes creative traces to mira", () => {
    const d = adaptParkedApproval(
      lifecycle,
      revision,
      makeTrace({
        intent: "creative.job.publish",
        deploymentContext: {
          deploymentId: "dep-c",
          skillSlug: "creative",
          trustLevel: "guided",
          trustScore: 0,
        },
      }),
    );
    expect(d.agentKey).toBe("mira");
  });
});

describe("adaptDegradedParkedApproval", () => {
  it("renders an actionable degraded card instead of silently skipping (review #5)", () => {
    const d = adaptDegradedParkedApproval(lifecycle);
    expect(d.kind).toBe("workflow_approval");
    expect(d.sourceRef.sourceId).toBe("lc-1");
    expect(d.humanSummary).toContain("could not be fully loaded");
    expect(d.humanSummary).toContain("lc-1".slice(0, 8));
    expect(d.meta.riskContract?.riskLevel).toBe("high");
    expect(d.meta.bindingHash).toBeUndefined(); // approve impossible; reject still works
    expect(d.agentKey).toBe("alex");
  });
});
