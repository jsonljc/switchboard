import { describe, it, expect, vi } from "vitest";
import { CtwaAdapter } from "@switchboard/ad-optimizer";
import {
  buildCtwaCampaignResolver,
  type CtwaConnectionRow,
} from "../gateway/ctwa-campaign-resolver.js";

/**
 * End-to-end (mocked-Meta) proof that a CTWA click with `ctwa_clid` + an ad
 * source resolves a `sourceCampaignId` onto the lead.intake payload. The Meta
 * Graph client is mocked — no network — and the org-scoped credential lookup is
 * a fake. This pins the seam main.ts wires: CtwaAdapter -> resolveCampaignId ->
 * org Connection -> MetaAdsClient.getAdCampaignId.
 */

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    from: "+6591234567",
    metadata: {
      ctwaClid: "ARxx_abc",
      sourceAdId: "ad_456",
      adSourceType: "ad",
      ctwaSourceUrl: "https://fb.me/abc",
    } as Record<string, unknown>,
    organizationId: "org-1",
    deploymentId: "dc-1",
    ...overrides,
  };
}

describe("buildCtwaCampaignResolver", () => {
  it("ctwa_clid -> sourceCampaignId: resolves the campaign id via the org-scoped Meta client", async () => {
    const getAdCampaignId = vi
      .fn<(adId: string) => Promise<string | null>>()
      .mockResolvedValue("campaign_123");
    const createAdsClient = vi.fn((_cfg: { accessToken: string; accountId: string }) => ({
      getAdCampaignId,
    }));
    const lookupConnection = vi
      .fn<(organizationId: string) => Promise<CtwaConnectionRow | null>>()
      .mockResolvedValue({
        credentials: "enc-blob",
        externalAccountId: "act_999",
      });
    const decryptCredentials = vi.fn((_blob: unknown) => ({
      accessToken: "tok-secret",
      accountId: "act_should_be_ignored",
    }));

    const resolveCampaignId = buildCtwaCampaignResolver({
      lookupConnection,
      decryptCredentials,
      createAdsClient,
    });

    const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
      resolveCampaignId,
    });

    await adapter.ingest(makeMessage());

    // The org-scoped credential path was driven by the lead's org and the ad id.
    expect(lookupConnection).toHaveBeenCalledWith("org-1");
    expect(decryptCredentials).toHaveBeenCalledWith("enc-blob");
    // accountId is sourced from the Connection's externalAccountId (Meta ad
    // account), matching the canonical dashboard-reports resolution.
    expect(createAdsClient).toHaveBeenCalledWith({
      accessToken: "tok-secret",
      accountId: "act_999",
    });
    expect(getAdCampaignId).toHaveBeenCalledWith("ad_456");

    const payload = (submit.mock.calls[0]![0] as Record<string, unknown>).payload as Record<
      string,
      unknown
    >;
    expect((payload.attribution as Record<string, unknown>).sourceCampaignId).toBe("campaign_123");
  });

  it("returns null (no sourceCampaignId) when the org has no Meta connection", async () => {
    const lookupConnection = vi
      .fn<(organizationId: string) => Promise<CtwaConnectionRow | null>>()
      .mockResolvedValue(null);
    const createAdsClient = vi.fn();
    const decryptCredentials = vi.fn();

    const resolveCampaignId = buildCtwaCampaignResolver({
      lookupConnection,
      decryptCredentials,
      createAdsClient,
    });

    const result = await resolveCampaignId("ad_456", { organizationId: "org-without-conn" });
    expect(result).toBeNull();
    expect(createAdsClient).not.toHaveBeenCalled();

    // And through the adapter, the payload carries no sourceCampaignId.
    const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
      resolveCampaignId,
    });
    await adapter.ingest(makeMessage({ organizationId: "org-without-conn" }));
    const payload = (submit.mock.calls[0]![0] as Record<string, unknown>).payload as Record<
      string,
      unknown
    >;
    expect((payload.attribution as Record<string, unknown>).sourceCampaignId).toBeUndefined();
  });

  it("returns null when the connection has no externalAccountId (account id unknown)", async () => {
    const lookupConnection = vi
      .fn<(organizationId: string) => Promise<CtwaConnectionRow | null>>()
      .mockResolvedValue({ credentials: "enc-blob", externalAccountId: null });
    const createAdsClient = vi.fn();
    const decryptCredentials = vi.fn(() => ({ accessToken: "tok", accountId: "act" }));

    const resolveCampaignId = buildCtwaCampaignResolver({
      lookupConnection,
      decryptCredentials,
      createAdsClient,
    });

    const result = await resolveCampaignId("ad_456", { organizationId: "org-1" });
    expect(result).toBeNull();
    expect(createAdsClient).not.toHaveBeenCalled();
  });

  it("returns null when decrypt yields no accessToken", async () => {
    const lookupConnection = vi
      .fn<(organizationId: string) => Promise<CtwaConnectionRow | null>>()
      .mockResolvedValue({ credentials: "enc-blob", externalAccountId: "act_999" });
    const createAdsClient = vi.fn();
    const decryptCredentials = vi.fn(() => ({ accountId: "act_999" }));

    const resolveCampaignId = buildCtwaCampaignResolver({
      lookupConnection,
      decryptCredentials,
      createAdsClient,
    });

    const result = await resolveCampaignId("ad_456", { organizationId: "org-1" });
    expect(result).toBeNull();
    expect(createAdsClient).not.toHaveBeenCalled();
  });

  it("returns null (swallows) when the lookup throws — never blocks lead intake", async () => {
    const lookupConnection = vi
      .fn<(organizationId: string) => Promise<CtwaConnectionRow | null>>()
      .mockRejectedValue(new Error("db down"));
    const createAdsClient = vi.fn();
    const decryptCredentials = vi.fn();

    const resolveCampaignId = buildCtwaCampaignResolver({
      lookupConnection,
      decryptCredentials,
      createAdsClient,
    });

    const result = await resolveCampaignId("ad_456", { organizationId: "org-1" });
    expect(result).toBeNull();
  });
});
