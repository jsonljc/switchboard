import { describe, it, expect, vi } from "vitest";
import { buildInstantFormIntake, InstantFormAdapter } from "./instant-form-adapter.js";

const makeLead = (overrides: Record<string, unknown> = {}) => ({
  leadgenId: "999",
  adId: "120000000",
  campaignId: "120000001",
  formId: "form_42",
  organizationId: "o1",
  deploymentId: "d1",
  fieldData: [
    { name: "email", values: ["a@b.com"] },
    { name: "full_name", values: ["Alice"] },
  ],
  ...overrides,
});

describe("buildInstantFormIntake", () => {
  it("produces a LeadIntake with leadgen_id idempotency", () => {
    const intake = buildInstantFormIntake(makeLead(), {
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    expect(intake).not.toBeNull();
    expect(intake!.source).toBe("instant_form");
    expect(intake!.contact.email).toBe("a@b.com");
    expect(intake!.contact.name).toBe("Alice");
    expect(intake!.attribution.leadgen_id).toBe("999");
    expect(intake!.idempotencyKey).toBe("leadgen:999");
  });

  it("normalizes phone to E.164 by adding + prefix when missing", () => {
    const intake = buildInstantFormIntake(
      makeLead({
        fieldData: [
          { name: "email", values: ["a@b.com"] },
          { name: "phone_number", values: ["6591234567"] },
        ],
      }),
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake!.contact.phone).toBe("+6591234567");
  });

  it("preserves phone with existing + prefix", () => {
    const intake = buildInstantFormIntake(
      makeLead({
        fieldData: [
          { name: "email", values: ["a@b.com"] },
          { name: "phone_number", values: ["+6591234567"] },
        ],
      }),
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake!.contact.phone).toBe("+6591234567");
  });

  it("treats empty-string field values as undefined", () => {
    const intake = buildInstantFormIntake(
      makeLead({
        fieldData: [
          { name: "email", values: ["a@b.com"] },
          { name: "full_name", values: [""] },
        ],
      }),
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake!.contact.name).toBeUndefined();
  });

  it("returns null when lead has neither email nor phone", () => {
    const intake = buildInstantFormIntake(
      makeLead({
        fieldData: [{ name: "full_name", values: ["Alice"] }],
      }),
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake).toBeNull();
  });

  it("returns null when email and phone are present but empty", () => {
    const intake = buildInstantFormIntake(
      makeLead({
        fieldData: [
          { name: "email", values: [""] },
          { name: "phone_number", values: [""] },
        ],
      }),
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake).toBeNull();
  });
});

describe("InstantFormAdapter", () => {
  it("submits via PlatformIngress", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    await adapter.ingest(makeLead());
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "lead.intake",
        payload: expect.objectContaining({ source: "instant_form" }),
      }),
    );
  });

  it("skips submission when lead has no email or phone", async () => {
    const submit = vi.fn();
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    await adapter.ingest(makeLead({ fieldData: [{ name: "full_name", values: ["Alice"] }] }));
    expect(submit).not.toHaveBeenCalled();
  });
});
