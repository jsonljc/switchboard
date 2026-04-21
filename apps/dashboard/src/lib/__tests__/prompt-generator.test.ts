import { describe, it, expect } from "vitest";
import { generateTestPrompts } from "../prompt-generator";
import { createEmptyPlaybook } from "@switchboard/schemas";
import type { Playbook } from "@switchboard/schemas";

const playbook: Playbook = {
  businessIdentity: {
    name: "Bright Smile",
    category: "dental",
    tagline: "",
    location: "SG",
    status: "ready",
    source: "scan",
  },
  services: [
    {
      id: "s1",
      name: "Teeth Whitening",
      price: 450,
      duration: 60,
      bookingBehavior: "ask_first",
      status: "ready",
      source: "scan",
    },
    {
      id: "s2",
      name: "Cleaning",
      price: 80,
      duration: 30,
      bookingBehavior: "book_directly",
      status: "ready",
      source: "scan",
    },
  ],
  hours: {
    timezone: "Asia/Singapore",
    schedule: { mon: "09:00-18:00", sat: "10:00-14:00" },
    afterHoursBehavior: "",
    status: "ready",
    source: "scan",
  },
  bookingRules: { leadVsBooking: "qualify first", status: "ready", source: "interview" },
  approvalMode: { bookingApproval: "ask_before_booking", status: "ready", source: "manual" },
  escalation: {
    triggers: ["refund", "complaint"],
    toneBoundaries: "",
    status: "ready",
    source: "interview",
  },
  channels: { configured: ["whatsapp"], status: "ready", source: "manual" },
};

describe("generateTestPrompts", () => {
  it("generates prompts with approved categories", () => {
    const prompts = generateTestPrompts(playbook);
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    expect(prompts.some((p) => p.category === "BOOKING")).toBe(true);
    expect(prompts.some((p) => p.category === "PRICING")).toBe(true);
    expect(prompts.some((p) => p.category === "CHANGES")).toBe(true);
    expect(prompts.some((p) => p.category === "EDGE_CASES")).toBe(true);
  });

  it("includes a booking prompt referencing the first service", () => {
    const prompts = generateTestPrompts(playbook);
    const booking = prompts.find((p) => p.category === "BOOKING");
    expect(booking?.text).toContain("Teeth Whitening");
  });

  it("marks the first prompt as recommended", () => {
    const prompts = generateTestPrompts(playbook);
    expect(prompts[0].recommended).toBe(true);
    expect(prompts.filter((p) => p.recommended)).toHaveLength(1);
  });

  it("includes an edge-case prompt for escalation triggers", () => {
    const prompts = generateTestPrompts(playbook);
    const edgeCase = prompts.filter((p) => p.category === "EDGE_CASES");
    expect(edgeCase.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array for empty playbook", () => {
    const prompts = generateTestPrompts(createEmptyPlaybook());
    expect(prompts).toHaveLength(0);
  });
});
