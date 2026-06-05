import { describe, it, expect } from "vitest";
import { BusinessFactsSchema } from "@switchboard/schemas";
import { WEEKDAYS, emptyBusinessFacts, serializeBusinessFacts } from "../scaffold";

describe("business-facts scaffold", () => {
  it("emptyBusinessFacts seeds 7 weekday rows, 1 location, 1 service, default tz", () => {
    const f = emptyBusinessFacts();
    expect(Object.keys(f.openingHours)).toEqual([...WEEKDAYS]);
    expect(f.locations).toHaveLength(1);
    expect(f.services).toHaveLength(1);
    expect(f.timezone).toBe("Asia/Singapore");
    expect(f.escalationContact.channel).toBe("whatsapp");
    expect(f.openingHours.sunday.closed).toBe(true);
  });

  it("returns a fresh object each call (no shared mutation)", () => {
    const a = emptyBusinessFacts();
    a.locations[0].name = "Mutated";
    expect(emptyBusinessFacts().locations[0].name).toBe("");
  });

  it("serializeBusinessFacts produces a schema-valid object and strips empty optionals", () => {
    const values = {
      ...emptyBusinessFacts(),
      businessName: "  Glow Aesthetics  ",
      locations: [
        { name: "Orchard", address: "391 Orchard Rd", parkingNotes: "", accessNotes: "" },
      ],
      services: [
        { name: "Botox", description: "Anti-wrinkle", price: "from $18/unit", currency: "SGD" },
      ],
      bookingPolicies: { advanceBookingDays: 60 },
      escalationContact: {
        name: "Front desk",
        channel: "whatsapp" as const,
        address: "+6560000000",
      },
    };
    const facts = serializeBusinessFacts(values);
    expect(BusinessFactsSchema.safeParse(facts).success).toBe(true);
    expect(facts.businessName).toBe("Glow Aesthetics"); // trimmed
    expect(facts.locations[0].parkingNotes).toBeUndefined(); // empty optional stripped
    expect(facts.bookingPolicies?.advanceBookingDays).toBe(60);
  });
});
