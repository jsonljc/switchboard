import { describe, it, expect, vi } from "vitest";
import { buildCtwaIntake, CtwaAdapter } from "./ctwa-adapter.js";

const makeMessage = (overrides: Record<string, unknown> = {}) => ({
  from: "+6591234567",
  metadata: {
    ctwaClid: "ARxx_abc",
    sourceAdId: "120000000",
    ctwaSourceUrl: "https://fb.me/abc",
  },
  organizationId: "o1",
  deploymentId: "d1",
  ...overrides,
});

describe("buildCtwaIntake", () => {
  it("produces a LeadIntake from a parsed WhatsApp message", () => {
    const intake = buildCtwaIntake(makeMessage(), { now: () => new Date("2026-04-26T00:00:00Z") });
    expect(intake).not.toBeNull();
    expect(intake!.source).toBe("ctwa");
    expect(intake!.contact.phone).toBe("+6591234567");
    expect(intake!.attribution.ctwa_clid).toBe("ARxx_abc");
    expect(intake!.idempotencyKey).toBe("+6591234567:ARxx_abc");
  });

  it("normalizes phone numbers without a + prefix to E.164", () => {
    const intake = buildCtwaIntake(makeMessage({ from: "6591234567" }), {
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    expect(intake).not.toBeNull();
    expect(intake!.contact.phone).toBe("+6591234567");
    expect(intake!.idempotencyKey).toBe("+6591234567:ARxx_abc");
  });

  it("returns null when message has no ctwa_clid", () => {
    const intake = buildCtwaIntake(makeMessage({ metadata: {} }), { now: () => new Date() });
    expect(intake).toBeNull();
  });
});

describe("CtwaAdapter", () => {
  it("submits via PlatformIngress with lead.intake intent", async () => {
    const submit = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { contactId: "c1", duplicate: false } } as unknown);
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    await adapter.ingest(makeMessage());
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "lead.intake",
        payload: expect.objectContaining({ source: "ctwa" }),
      }),
    );
  });

  it("skips submission for non-CTWA messages", async () => {
    const submit = vi.fn();
    const adapter = new CtwaAdapter({ ingress: { submit }, now: () => new Date() });
    await adapter.ingest(makeMessage({ metadata: {} }));
    expect(submit).not.toHaveBeenCalled();
  });
});
