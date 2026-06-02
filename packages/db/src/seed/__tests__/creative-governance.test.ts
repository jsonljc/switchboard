import { describe, it, expect } from "vitest";
import {
  buildCreativePublishApprovalPolicyInput,
  creativePublishApprovalPolicyId,
} from "../creative-governance.js";

describe("buildCreativePublishApprovalPolicyInput", () => {
  it("is an org-scoped require_approval(mandatory) policy matching ONLY creative.job.publish", () => {
    const p = buildCreativePublishApprovalPolicyInput("org_1");
    expect(p.id).toBe(creativePublishApprovalPolicyId("org_1"));
    expect(p.organizationId).toBe("org_1");
    expect(p.effect).toBe("require_approval");
    expect(p.approvalRequirement).toBe("mandatory");
    expect(p.active).toBe(true);

    const cond = (
      p.rule as { conditions: Array<{ field: string; operator: string; value: string }> }
    ).conditions[0];
    expect(cond.field).toBe("actionType");
    expect(cond.operator).toBe("matches");
    // anchored + escaped: matches publish exactly, never submit/continue/stop
    expect(new RegExp(cond.value).test("creative.job.publish")).toBe(true);
    expect(new RegExp(cond.value).test("creative.job.continue")).toBe(false);
    expect(new RegExp(cond.value).test("creative.job.submit")).toBe(false);
    expect(new RegExp(cond.value).test("creative.job.stop")).toBe(false);
  });
});
