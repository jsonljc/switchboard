import { describe, it, expect } from "vitest";
import { ConversationFixtureSchema } from "../schema.js";

describe("ConversationFixtureSchema", () => {
  it("defaults businessFacts to 'operator' and accepts 'absent'", () => {
    const base = {
      id: "bf-default",
      vertical: "medspa",
      locale: "sg",
      scenario: "x",
      turns: [
        { role: "lead", content: "hi" },
        { role: "alex", grade: { mustAsk: [], mustDo: [], mustNot: [], shouldDo: [] } },
      ],
    };
    expect(ConversationFixtureSchema.parse(base).businessFacts).toBe("operator");
    expect(
      ConversationFixtureSchema.parse({ ...base, businessFacts: "absent" }).businessFacts,
    ).toBe("absent");
    expect(() => ConversationFixtureSchema.parse({ ...base, businessFacts: "nope" })).toThrow();
  });

  it("accepts a scripted fixture with fixed lead turns + alex grade blocks", () => {
    const row = {
      id: "medspa_price_shopper_001",
      vertical: "medspa",
      locale: "sg",
      scenario: "price_objection",
      turns: [
        { role: "lead", content: "How much is Botox? cheapest option please." },
        {
          role: "alex",
          grade: {
            mustNot: ["guarantee_results", "push_discount_first"],
            shouldDo: ["acknowledge_price_sensitivity", "position_consultation"],
          },
        },
      ],
    };
    expect(ConversationFixtureSchema.parse(row).turns).toHaveLength(2);
  });
  it("rejects a fixture whose last turn is a lead turn (must end on alex)", () => {
    const bad = {
      id: "x",
      vertical: "medspa",
      locale: "sg",
      scenario: "s",
      turns: [{ role: "lead", content: "hi" }],
    };
    expect(ConversationFixtureSchema.safeParse(bad).success).toBe(false);
  });
});
