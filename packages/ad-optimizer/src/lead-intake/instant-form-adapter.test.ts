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

  it("normalizes phone to E.164 by adding +65 prefix to a bare SG mobile", () => {
    const intake = buildInstantFormIntake(
      makeLead({
        fieldData: [
          { name: "email", values: ["a@b.com"] },
          { name: "phone_number", values: ["91234567"] },
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

  it("normalizes a bare SG 8-digit phone field to +65 via the canonical normalizer", () => {
    const intake = buildInstantFormIntake(
      {
        leadgenId: "lg-1",
        organizationId: "o1",
        deploymentId: "d1",
        fieldData: [{ name: "phone_number", values: ["91234567"] }],
      },
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake).not.toBeNull();
    expect(intake!.contact.phone).toBe("+6591234567");
  });

  it("marks a phone-bearing Instant Form lead as a whatsapp-channel lead (so the handler captures the ad-form opt-in)", () => {
    // The handler keys messagingOptIn=true / messagingOptInSource="web_form" off
    // contact.channel === "whatsapp" for an instant_form lead (lead-intake-handler.test.ts).
    // Without this, every IF greeting would dark-hole at no_optin.
    const intake = buildInstantFormIntake(
      makeLead({
        fieldData: [
          { name: "phone_number", values: ["91234567"] },
          { name: "full_name", values: ["Alice"] },
        ],
      }),
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake!.contact.phone).toBe("+6591234567");
    expect(intake!.contact.channel).toBe("whatsapp");
  });

  it("does NOT mark an email-only Instant Form lead (no phone) as a whatsapp lead", () => {
    const intake = buildInstantFormIntake(
      makeLead({
        fieldData: [
          { name: "email", values: ["a@b.com"] },
          { name: "full_name", values: ["Alice"] },
        ],
      }),
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake!.contact.email).toBe("a@b.com");
    expect(intake!.contact.channel).toBeUndefined();
  });

  it("still ingests when phone is un-normalizable but an email is present", () => {
    const intake = buildInstantFormIntake(
      {
        leadgenId: "lg-2",
        organizationId: "o1",
        deploymentId: "d1",
        fieldData: [
          { name: "phone_number", values: ["not-a-phone"] },
          { name: "email", values: ["a@b.com"] },
        ],
      },
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake).not.toBeNull();
    expect(intake!.contact.email).toBe("a@b.com");
    expect(intake!.contact.phone).toBeUndefined();
  });
});

describe("InstantFormAdapter", () => {
  it("submits via PlatformIngress and returns the resolved contactId", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: { outputs: { contactId: "contact_42", duplicate: false } },
    });
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    const out = await adapter.ingest(makeLead());
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "lead.intake",
        payload: expect.objectContaining({ source: "instant_form" }),
      }),
    );
    expect(out).toEqual({ contactId: "contact_42", duplicate: false });
  });

  it("propagates duplicate=true when the lead.intake handler reports a duplicate", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: { outputs: { contactId: "contact_42", duplicate: true } },
    });
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    const out = await adapter.ingest(makeLead());
    expect(out).toEqual({ contactId: "contact_42", duplicate: true });
  });

  it("skips submission and returns null when lead has no email or phone", async () => {
    const submit = vi.fn();
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    const out = await adapter.ingest(
      makeLead({ fieldData: [{ name: "full_name", values: ["Alice"] }] }),
    );
    expect(submit).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it("forwards parentWorkUnitId to the submit call when provided", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: { outputs: { contactId: "contact_42", duplicate: false } },
    });
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    await adapter.ingest(makeLead(), { parentWorkUnitId: "parent_wu_1" });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ parentWorkUnitId: "parent_wu_1" }),
    );
  });

  it("does not include parentWorkUnitId when not provided", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: { outputs: { contactId: "contact_42", duplicate: false } },
    });
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    await adapter.ingest(makeLead());
    const call = submit.mock.calls[0]![0];
    expect(call.parentWorkUnitId).toBeUndefined();
  });

  it("returns null when ingress response lacks a contactId", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, result: { outputs: {} } });
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    const out = await adapter.ingest(makeLead());
    expect(out).toBeNull();
  });

  it("threads region through to the builder: 0-prefixed MY number normalizes to +60", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: { outputs: { contactId: "contact_my_1", duplicate: false } },
    });
    const adapter = new InstantFormAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
      region: "MY",
    });
    const lead = makeLead({
      fieldData: [{ name: "phone_number", values: ["0123456789"] }],
    });
    const out = await adapter.ingest(lead);
    expect(out).toEqual({ contactId: "contact_my_1", duplicate: false });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          contact: expect.objectContaining({ phone: "+60123456789" }),
        }),
      }),
    );
  });
});
