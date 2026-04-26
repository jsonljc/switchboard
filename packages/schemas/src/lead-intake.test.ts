import { describe, it, expect } from "vitest";
import { LeadIntakeSchema } from "./lead-intake.js";

describe("LeadIntakeSchema", () => {
  it("validates a CTWA intake", () => {
    const intake = LeadIntakeSchema.parse({
      source: "ctwa",
      organizationId: "o1",
      deploymentId: "d1",
      contact: { phone: "+6591234567", channel: "whatsapp" },
      attribution: {
        ctwa_clid: "ARxx_abc",
        sourceAdId: "120000000",
        sourceCampaignId: "120000001",
        capturedAt: "2026-04-26T00:00:00Z",
      },
      idempotencyKey: "+6591234567:ARxx_abc",
    });
    expect(intake.source).toBe("ctwa");
  });

  it("validates an Instant Form intake", () => {
    const intake = LeadIntakeSchema.parse({
      source: "instant_form",
      organizationId: "o1",
      deploymentId: "d1",
      contact: { email: "a@b.com" },
      attribution: {
        leadgen_id: "999",
        sourceAdId: "120000000",
        sourceCampaignId: "120000001",
        capturedAt: "2026-04-26T00:00:00Z",
      },
      idempotencyKey: "leadgen:999",
    });
    expect(intake.source).toBe("instant_form");
  });

  it("rejects intake with no contact identifier", () => {
    expect(() =>
      LeadIntakeSchema.parse({
        source: "ctwa",
        organizationId: "o1",
        deploymentId: "d1",
        contact: {},
        attribution: { capturedAt: "2026-04-26T00:00:00Z" },
        idempotencyKey: "x",
      }),
    ).toThrow();
  });
});
