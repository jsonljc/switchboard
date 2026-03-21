import { describe, it, expect } from "vitest";
import { DeploymentReadinessChecker } from "../readiness-checker.js";
import type { BusinessProfile } from "@switchboard/schemas";

function makeProfile(overrides?: Partial<BusinessProfile>): BusinessProfile {
  return {
    id: "test",
    name: "Test Business",
    version: "1.0.0",
    business: {
      name: "Test Business",
      type: "dental",
      phone: "+65123456",
      timezone: "Asia/Singapore",
    },
    services: {
      catalog: [{ id: "s1", name: "Cleaning", category: "preventive" }],
    },
    journey: {
      stages: [{ id: "new_lead", name: "New Lead", metric: "new_leads", terminal: false }],
      primaryKPI: "new_leads",
    },
    ...overrides,
  };
}

describe("DeploymentReadinessChecker", () => {
  const checker = new DeploymentReadinessChecker();

  it("should pass with complete config", () => {
    const result = checker.check(
      makeProfile({
        hours: { monday: { open: "09:00", close: "17:00" } },
        faqs: [
          { question: "Q1", answer: "A1" },
          { question: "Q2", answer: "A2" },
          { question: "Q3", answer: "A3" },
        ],
        escalationConfig: {
          contacts: [{ id: "c1", name: "Owner", channel: "whatsapp", channelId: "123" }],
        },
        booking: { bookingUrl: "https://book.example.com" },
        persona: { name: "Alex" },
      }),
      true,
    );

    expect(result.ready).toBe(true);
    expect(result.score).toBeGreaterThan(80);
  });

  it("should fail without escalation contacts", () => {
    const result = checker.check(makeProfile(), true);
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.name === "escalation_config")?.passed).toBe(false);
  });

  it("should fail without channel configured", () => {
    const result = checker.check(
      makeProfile({
        escalationConfig: {
          contacts: [{ id: "c1", name: "Owner", channel: "whatsapp", channelId: "123" }],
        },
      }),
      false,
    );
    expect(result.ready).toBe(false);
  });

  it("should warn about missing FAQs", () => {
    const result = checker.check(makeProfile(), true);
    expect(result.checks.find((c) => c.name === "faqs")?.severity).toBe("warning");
  });

  it("should fail without business phone", () => {
    const result = checker.check(
      makeProfile({
        business: { name: "Test", type: "dental" },
      }),
      true,
    );
    expect(result.checks.find((c) => c.name === "business_phone")?.passed).toBe(false);
  });
});
