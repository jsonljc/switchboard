import { describe, it, expect } from "vitest";
import {
  buildRecommendationHandoffAllowPolicyInput,
  buildRecommendationHandoffApprovalPolicyInput,
  RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE,
} from "../recommendation-handoff-governance.js";

describe("recommendation-handoff governance config", () => {
  it("the allow policy matches the handoff intent (anchored + escaped)", () => {
    expect(RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE.conditions[0]!.value).toBe(
      "^adoptimizer\\.recommendation\\.handoff$",
    );
  });

  it("the approval policy is org-scoped, mandatory, and require_approval", () => {
    const p = buildRecommendationHandoffApprovalPolicyInput("org_x");
    expect(p.organizationId).toBe("org_x");
    expect(p.effect).toBe("require_approval");
    expect(p.approvalRequirement).toBe("mandatory");
    expect(p.id).toContain("org_x");
  });

  it("the allow policy is allow-effect and org-scoped", () => {
    const p = buildRecommendationHandoffAllowPolicyInput("org_x");
    expect(p.effect).toBe("allow");
    expect(p.organizationId).toBe("org_x");
  });

  it("the two policy ids are distinct and deterministic per org", () => {
    const allow = buildRecommendationHandoffAllowPolicyInput("org_x");
    const approval = buildRecommendationHandoffApprovalPolicyInput("org_x");
    expect(allow.id).not.toBe(approval.id);
    expect(buildRecommendationHandoffAllowPolicyInput("org_x").id).toBe(allow.id);
  });
});
