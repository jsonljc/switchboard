import { describe, it, expect } from "vitest";
import { hydratePlaybookFromScan } from "../scan-to-playbook";
import { createEmptyPlaybook } from "@switchboard/schemas";
import type { ScanResult } from "@switchboard/schemas";

describe("hydratePlaybookFromScan", () => {
  const idFactory = (i: number) => `scan-${i}`;

  it("maps businessName and category into businessIdentity as check_this", () => {
    const scan: ScanResult = {
      businessName: { value: "Bright Smile Dental", confidence: "high" },
      category: { value: "Dental Clinic", confidence: "medium" },
      location: { value: "Singapore", confidence: "high" },
      services: [],
      contactMethods: [],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.businessIdentity.name).toBe("Bright Smile Dental");
    expect(result.businessIdentity.category).toBe("Dental Clinic");
    expect(result.businessIdentity.location).toBe("Singapore");
    expect(result.businessIdentity.status).toBe("check_this");
    expect(result.businessIdentity.source).toBe("scan");
  });

  it("maps all services as check_this regardless of confidence", () => {
    const scan: ScanResult = {
      services: [
        { name: "Teeth Whitening", price: 450, duration: 60, confidence: "high" },
        { name: "Cleaning", confidence: "medium" },
      ],
      contactMethods: [],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("Teeth Whitening");
    expect(result.services[0].price).toBe(450);
    expect(result.services[0].duration).toBe(60);
    expect(result.services[0].status).toBe("check_this");
    expect(result.services[0].source).toBe("scan");
    expect(result.services[1].status).toBe("check_this");
  });

  it("uses deterministic IDs from idFactory", () => {
    const scan: ScanResult = {
      services: [
        { name: "A", confidence: "high" },
        { name: "B", confidence: "high" },
      ],
      contactMethods: [],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.services[0].id).toBe("scan-0");
    expect(result.services[1].id).toBe("scan-1");
  });

  it("maps hours schedule as check_this", () => {
    const scan: ScanResult = {
      services: [],
      hours: { mon: "09:00-18:00", tue: "09:00-18:00", sat: "10:00-14:00" },
      contactMethods: [],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.hours.schedule).toEqual({
      mon: "09:00-18:00",
      tue: "09:00-18:00",
      sat: "10:00-14:00",
    });
    expect(result.hours.status).toBe("check_this");
    expect(result.hours.source).toBe("scan");
  });

  it("sets contactMethods as channel hints", () => {
    const scan: ScanResult = {
      services: [],
      contactMethods: ["WhatsApp", "Phone"],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.channels.configured).toEqual(["WhatsApp", "Phone"]);
    expect(result.channels.status).toBe("check_this");
  });

  it("leaves sections untouched when scan data is absent", () => {
    const scan: ScanResult = { services: [], contactMethods: [], faqHints: [] };
    const base = createEmptyPlaybook();
    const result = hydratePlaybookFromScan(base, scan, idFactory);
    expect(result.businessIdentity.status).toBe("missing");
    expect(result.hours.status).toBe("missing");
    expect(result.bookingRules.status).toBe("missing");
  });
});
