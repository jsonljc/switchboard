import { describe, it, expect } from "vitest";
import {
  PlaybookSchema,
  PlaybookSectionStatus,
  PlaybookServiceSchema,
  PlaybookReadinessSchema,
  type Playbook,
} from "../playbook.js";

describe("PlaybookSchema", () => {
  it("validates a complete playbook", () => {
    const playbook: Playbook = {
      businessIdentity: {
        name: "Bright Smile Dental",
        category: "dental",
        tagline: "Your family dentist",
        location: "Singapore",
        status: "ready",
        source: "scan",
      },
      services: [
        {
          id: "svc-1",
          name: "Teeth Whitening",
          price: 350,
          duration: 60,
          bookingBehavior: "book_directly",
          details: "Professional LED whitening",
          status: "ready",
          source: "scan",
        },
      ],
      hours: {
        timezone: "Asia/Singapore",
        schedule: { mon: "09:00-18:00", tue: "09:00-18:00" },
        afterHoursBehavior: "Take message, respond next business day",
        status: "check_this",
        source: "scan",
      },
      bookingRules: {
        leadVsBooking: "Alex qualifies first, then offers to book",
        status: "missing",
        source: "manual",
      },
      approvalMode: {
        bookingApproval: "book_if_open_ask_if_odd",
        pricingApproval: "share_if_in_playbook",
        status: "missing",
        source: "manual",
      },
      escalation: {
        triggers: [],
        toneBoundaries: "",
        status: "missing",
        source: "manual",
      },
      channels: {
        recommended: "whatsapp",
        configured: [],
        status: "missing",
        source: "manual",
      },
    };

    const result = PlaybookSchema.safeParse(playbook);
    expect(result.success).toBe(true);
  });

  it("rejects a service without a name", () => {
    const service = {
      id: "svc-1",
      name: "",
      bookingBehavior: "book_directly",
      status: "ready",
      source: "manual",
    };
    const result = PlaybookServiceSchema.safeParse(service);
    expect(result.success).toBe(false);
  });

  it("computes readiness from playbook", () => {
    const readiness = PlaybookReadinessSchema.parse({
      businessIdentity: "ready",
      services: "ready",
      hours: "check_this",
      bookingRules: "missing",
      approvalMode: "ready",
    });
    expect(readiness.businessIdentity).toBe("ready");
    expect(readiness.bookingRules).toBe("missing");
  });
});

describe("PlaybookSectionStatus", () => {
  it("accepts valid statuses", () => {
    expect(PlaybookSectionStatus.safeParse("ready").success).toBe(true);
    expect(PlaybookSectionStatus.safeParse("check_this").success).toBe(true);
    expect(PlaybookSectionStatus.safeParse("missing").success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(PlaybookSectionStatus.safeParse("done").success).toBe(false);
  });
});
