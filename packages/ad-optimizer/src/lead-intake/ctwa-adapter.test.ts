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

  it("normalizes a bare SG 8-digit phone to +65 via the canonical normalizer", () => {
    const intake = buildCtwaIntake(makeMessage({ from: "91234567" }), {
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    expect(intake).not.toBeNull();
    expect(intake!.contact.phone).toBe("+6591234567");
    expect(intake!.idempotencyKey).toBe("+6591234567:ARxx_abc");
  });

  it("normalizes a 0-prefixed MY number to +60 when region 'MY' is threaded", () => {
    const intake = buildCtwaIntake(makeMessage({ from: "0123456789" }), {
      now: () => new Date("2026-04-26T00:00:00Z"),
      region: "MY",
    });
    expect(intake).not.toBeNull();
    expect(intake!.contact.phone).toBe("+60123456789");
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

  it("forwards parentWorkUnitId to the submit call when provided", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    await adapter.ingest(makeMessage(), { parentWorkUnitId: "parent_wu_1" });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ parentWorkUnitId: "parent_wu_1" }),
    );
  });

  it("skips submission for non-CTWA messages", async () => {
    const submit = vi.fn();
    const adapter = new CtwaAdapter({ ingress: { submit }, now: () => new Date() });
    await adapter.ingest(makeMessage({ metadata: {} }));
    expect(submit).not.toHaveBeenCalled();
  });

  it("resolves sourceCampaignId when adSourceType is 'ad' and resolver is provided", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
    const resolveCampaignId = vi.fn().mockResolvedValue("campaign_123");
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
      resolveCampaignId,
    });
    await adapter.ingest(
      makeMessage({ metadata: { ctwaClid: "ARxx_abc", sourceAdId: "ad_456", adSourceType: "ad" } }),
    );
    expect(resolveCampaignId).toHaveBeenCalledWith("ad_456");
    const payload = (submit.mock.calls[0]![0] as Record<string, unknown>).payload as Record<
      string,
      unknown
    >;
    expect((payload.attribution as Record<string, unknown>).sourceCampaignId).toBe("campaign_123");
  });

  it("skips campaign resolution when adSourceType is not 'ad'", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
    const resolveCampaignId = vi.fn();
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
      resolveCampaignId,
    });
    await adapter.ingest(
      makeMessage({
        metadata: { ctwaClid: "ARxx_abc", sourceAdId: "post_789", adSourceType: "post" },
      }),
    );
    expect(resolveCampaignId).not.toHaveBeenCalled();
  });

  it("continues without sourceCampaignId when resolver throws", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
    const resolveCampaignId = vi.fn().mockRejectedValue(new Error("API error"));
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
      resolveCampaignId,
    });
    await adapter.ingest(
      makeMessage({ metadata: { ctwaClid: "ARxx_abc", sourceAdId: "ad_456", adSourceType: "ad" } }),
    );
    expect(submit).toHaveBeenCalled();
    const payload = (submit.mock.calls[0]![0] as Record<string, unknown>).payload as Record<
      string,
      unknown
    >;
    expect((payload.attribution as Record<string, unknown>).sourceCampaignId).toBeUndefined();
  });

  it("skips resolution when no resolveCampaignId dep is provided", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    await adapter.ingest(
      makeMessage({ metadata: { ctwaClid: "ARxx_abc", sourceAdId: "ad_456", adSourceType: "ad" } }),
    );
    expect(submit).toHaveBeenCalled();
  });
});
