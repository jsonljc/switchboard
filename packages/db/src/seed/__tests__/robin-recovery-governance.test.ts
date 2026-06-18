import { describe, it, expect, vi } from "vitest";
import {
  buildRobinRecoveryAllowPolicyInput,
  buildRobinRecoveryApprovalPolicyInput,
  seedRobinRecoveryPolicies,
} from "../robin-recovery-governance.js";

describe("robin recovery governance policies", () => {
  it("the allow policy is an anchored allow for the recovery intent", () => {
    const p = buildRobinRecoveryAllowPolicyInput("org_1");
    expect(p.effect).toBe("allow");
    expect(p.organizationId).toBe("org_1");
    expect(p.rule.conditions[0]).toMatchObject({
      field: "actionType",
      operator: "matches",
      value: "^robin\\.recovery_campaign\\.send$",
    });
  });

  it("the approval policy is mandatory require_approval for the recovery intent", () => {
    const p = buildRobinRecoveryApprovalPolicyInput("org_1");
    expect(p.effect).toBe("require_approval");
    expect(p.approvalRequirement).toBe("mandatory");
    expect(p.rule.conditions[0]!.value).toBe("^robin\\.recovery_campaign\\.send$");
  });

  it("seeds BOTH policies (never one without the other)", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    await seedRobinRecoveryPolicies({ policy: { upsert } } as never, "org_1");
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
