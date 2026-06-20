import { describe, it, expect, vi } from "vitest";
import {
  buildProactiveIntakeAllowPolicyInput,
  PROACTIVE_INTAKE_POLICY_RULE,
  seedProactiveIntakePolicies,
} from "../proactive-intake-governance.js";

describe("proactive + intake governance policy", () => {
  it("is an anchored allow policy over the platform-initiated family", () => {
    const p = buildProactiveIntakeAllowPolicyInput("org_1");
    expect(p.effect).toBe("allow");
    expect(p.organizationId).toBe("org_1");
    expect(p.rule.conditions[0]).toMatchObject({ field: "actionType", operator: "matches" });
  });

  it("matches every family intent and rejects unrelated / partial intents (anchored + escaped)", () => {
    const re = new RegExp(PROACTIVE_INTAKE_POLICY_RULE.conditions[0]!.value);
    for (const intent of [
      "conversation.reminder.send",
      "conversation.followup.send",
      "meta.lead.greeting.send",
      "meta.lead.inquiry.record",
      "lead.intake",
      "meta.lead.intake",
    ]) {
      expect(re.test(intent)).toBe(true);
    }
    // anchored: no prefix/suffix slop; escaped dots: not a wildcard
    expect(re.test("conversation.reminder.sendX")).toBe(false);
    expect(re.test("xlead.intake")).toBe(false);
    expect(re.test("conversationXreminder.send")).toBe(false);
    // sibling families governed elsewhere must NOT be swept in
    expect(re.test("robin.recovery_campaign.send")).toBe(false);
    expect(re.test("alex.conversation")).toBe(false);
    expect(re.test("adoptimizer.campaign.reallocate")).toBe(false);
  });

  it("seeds exactly ONE allow policy (allow-only — NOT a require_approval pair like Robin)", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    await seedProactiveIntakePolicies({ policy: { upsert } } as never, "org_1");
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as { create: { effect: string } };
    expect(arg.create.effect).toBe("allow");
  });
});
