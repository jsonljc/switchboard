// apps/dashboard/src/lib/__tests__/interview-parsers.test.ts
import { describe, it, expect } from "vitest";
import {
  parseBusinessIdentityResponse,
  parseServicesResponse,
  parseHoursResponse,
  parseEscalationTriggers,
} from "../interview-parsers";

describe("parseBusinessIdentityResponse", () => {
  it("strips common prefixes and extracts name", () => {
    expect(parseBusinessIdentityResponse("We're Bright Smile Dental, a dental clinic")).toEqual({
      name: "Bright Smile Dental",
    });
  });

  it("handles simple name without prefix", () => {
    expect(parseBusinessIdentityResponse("Bright Smile Dental")).toEqual({
      name: "Bright Smile Dental",
    });
  });

  it("returns null for empty input", () => {
    expect(parseBusinessIdentityResponse("")).toBeNull();
    expect(parseBusinessIdentityResponse("  ")).toBeNull();
  });
});

describe("parseServicesResponse", () => {
  it("extracts services with dollar prices", () => {
    const result = parseServicesResponse("Teeth whitening $450, cleaning $80");
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ name: "Teeth whitening", price: 450 });
    expect(result![1]).toEqual({ name: "cleaning", price: 80 });
  });

  it("extracts services without prices", () => {
    const result = parseServicesResponse("Consultation, follow-up");
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ name: "Consultation" });
    expect(result![1]).toEqual({ name: "follow-up" });
  });

  it("returns null for empty input", () => {
    expect(parseServicesResponse("")).toBeNull();
  });

  it("handles newline-separated services", () => {
    const result = parseServicesResponse("Whitening $450\nCleaning $80\nInvisalign $5000");
    expect(result).toHaveLength(3);
  });
});

describe("parseHoursResponse", () => {
  it("returns raw text as schedule (structured parsing is v2)", () => {
    const result = parseHoursResponse("Mon-Fri 9am to 6pm, Saturday 10am to 2pm");
    expect(result).toEqual({ schedule: "Mon-Fri 9am to 6pm, Saturday 10am to 2pm" });
  });

  it("returns null for empty input", () => {
    expect(parseHoursResponse("")).toBeNull();
  });
});

describe("parseEscalationTriggers", () => {
  it("splits comma-separated triggers", () => {
    expect(parseEscalationTriggers("refund, complaint, legal")).toEqual([
      "refund",
      "complaint",
      "legal",
    ]);
  });

  it("splits semicolon-separated triggers", () => {
    expect(parseEscalationTriggers("refund; complaint")).toEqual(["refund", "complaint"]);
  });

  it("returns null for empty input", () => {
    expect(parseEscalationTriggers("")).toBeNull();
  });
});
