import { describe, it, expect } from "vitest";
import { DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES } from "../policies.js";

describe("DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES", () => {
  it("defines 4 policies", () => {
    expect(DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES).toHaveLength(4);
  });

  it("all policies have required fields", () => {
    for (const policy of DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES) {
      expect(policy.id).toBeTruthy();
      expect(policy.name).toBeTruthy();
      expect(policy.description).toBeTruthy();
      expect(policy.cartridgeId).toBe("customer-engagement");
      expect(policy.active).toBe(true);
      expect(policy.rule).toBeDefined();
      expect(policy.effect).toBeTruthy();
      expect(typeof policy.priority).toBe("number");
    }
  });

  it("policies are ordered by priority", () => {
    const priorities = DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES.map((p) => p.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThan(priorities[i - 1]!);
    }
  });

  it("consent policy (priority 1) denies outbound communication without consent", () => {
    const consent = DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES.find(
      (p) => p.id === "customer-engagement-consent-required",
    );
    expect(consent).toBeDefined();
    expect(consent!.priority).toBe(1);
    expect(consent!.effect).toBe("deny");
    expect(consent!.rule.composition).toBe("AND");
    expect(consent!.rule.conditions).toHaveLength(2);
    // First condition: actionType in [reminder, review, cadence]
    const actionCond = consent!.rule.conditions[0]!;
    expect(actionCond.field).toBe("actionType");
    expect(actionCond.operator).toBe("in");
    expect(actionCond.value).toContain("customer-engagement.reminder.send");
  });

  it("review response policy (priority 5) requires elevated approval", () => {
    const review = DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES.find(
      (p) => p.id === "customer-engagement-review-elevated-approval",
    );
    expect(review).toBeDefined();
    expect(review!.priority).toBe(5);
    expect(review!.effect).toBe("require_approval");
    expect(review!.approvalRequirement).toBe("elevated");
  });

  it("booking policy (priority 10) requires standard approval for booking actions", () => {
    const booking = DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES.find(
      (p) => p.id === "customer-engagement-booking-approval",
    );
    expect(booking).toBeDefined();
    expect(booking!.effect).toBe("require_approval");
    expect(booking!.approvalRequirement).toBe("standard");
    const actionCond = booking!.rule.conditions[0]!;
    expect(actionCond.value).toContain("customer-engagement.appointment.book");
    expect(actionCond.value).toContain("customer-engagement.appointment.cancel");
    expect(actionCond.value).toContain("customer-engagement.appointment.reschedule");
  });

  it("treatment policy (priority 20) requires standard approval for treatment logging", () => {
    const treatment = DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES.find(
      (p) => p.id === "customer-engagement-treatment-approval",
    );
    expect(treatment).toBeDefined();
    expect(treatment!.effect).toBe("require_approval");
    expect(treatment!.approvalRequirement).toBe("standard");
  });

  it("all policies have null organizationId (global defaults)", () => {
    for (const policy of DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES) {
      expect(policy.organizationId).toBeNull();
    }
  });
});
