import { describe, expect, it } from "vitest";
import { IntentClassSchema, TemplateCategorySchema } from "./intent-class.js";

describe("IntentClassSchema", () => {
  it("accepts every valid intent class", () => {
    for (const v of [
      "appointment-confirm",
      "appointment-reminder",
      "aftercare-checkin",
      "re-engagement-offer",
      "consult-followup",
    ]) {
      expect(IntentClassSchema.parse(v)).toBe(v);
    }
  });

  it("rejects unknown values", () => {
    expect(() => IntentClassSchema.parse("unknown")).toThrow();
  });
});

describe("TemplateCategorySchema", () => {
  it("accepts every valid category", () => {
    for (const v of ["utility", "marketing", "authentication"]) {
      expect(TemplateCategorySchema.parse(v)).toBe(v);
    }
  });

  it("rejects unknown values", () => {
    expect(() => TemplateCategorySchema.parse("service")).toThrow();
  });
});
