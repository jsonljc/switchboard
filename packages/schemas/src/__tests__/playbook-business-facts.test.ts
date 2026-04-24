import { describe, it, expect } from "vitest";
import { PlaybookSchema, createEmptyPlaybook } from "../playbook.js";

describe("PlaybookSchema businessFacts", () => {
  it("accepts a playbook with businessFacts", () => {
    const playbook = createEmptyPlaybook();
    const withFacts = {
      ...playbook,
      businessFacts: {
        serviceArea: "Downtown Singapore, 5km radius",
        contactPreference: "whatsapp" as const,
        escalationContact: "owner@example.com",
        uniqueSellingPoints: ["24/7 availability", "Same-day service"],
        targetCustomer: "Busy professionals aged 25-45",
      },
    };
    const result = PlaybookSchema.safeParse(withFacts);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.businessFacts?.serviceArea).toBe("Downtown Singapore, 5km radius");
      expect(result.data.businessFacts?.uniqueSellingPoints).toHaveLength(2);
    }
  });

  it("accepts a playbook without businessFacts (backward compatible)", () => {
    const playbook = createEmptyPlaybook();
    const result = PlaybookSchema.safeParse(playbook);
    expect(result.success).toBe(true);
  });

  it("accepts partial businessFacts (all fields optional)", () => {
    const playbook = createEmptyPlaybook();
    const withPartial = {
      ...playbook,
      businessFacts: { serviceArea: "Manhattan" },
    };
    const result = PlaybookSchema.safeParse(withPartial);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.businessFacts?.serviceArea).toBe("Manhattan");
      expect(result.data.businessFacts?.contactPreference).toBeUndefined();
    }
  });

  it("rejects invalid contactPreference enum value", () => {
    const playbook = createEmptyPlaybook();
    const withBadEnum = {
      ...playbook,
      businessFacts: { contactPreference: "carrier-pigeon" },
    };
    const result = PlaybookSchema.safeParse(withBadEnum);
    expect(result.success).toBe(false);
  });
});
