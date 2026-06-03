import { describe, it, expect, vi } from "vitest";

const { inngestCreateFunction } = vi.hoisted(() => ({
  inngestCreateFunction: vi.fn((_cfg: unknown, _handler: unknown) => ({ id: "creative-publish" })),
}));
vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { createFunction: inngestCreateFunction },
}));

const { executeCreativePublish, CREATIVE_PUBLISH_FAILURE_PARAMS, PARKED_PAUSED } =
  await import("../creative-publish-function.js");
const { makeOnFailureHandler } = await import("@switchboard/core");

const ORG = "org_1";
const JOB = "job_1";

/** step.run mock: invokes the callback and returns its value (no Inngest memoization). */
const step = { run: async (_id: string, fn: () => unknown) => fn() } as never;

function makeAds() {
  return {
    uploadCreativeAsset: vi.fn().mockResolvedValue({ id: "vid_1", url: "u" }),
    createDraftCampaign: vi.fn().mockResolvedValue({ id: "camp_1" }),
    createDraftAdSet: vi.fn().mockResolvedValue({ id: "set_1" }),
    createAdCreative: vi.fn().mockResolvedValue({ id: "cr_1" }),
    createAd: vi.fn().mockResolvedValue({ id: "ad_1" }),
  };
}

function makeStore(initial: Record<string, unknown>) {
  let row = { ...initial };
  return {
    findById: vi.fn(async () => ({ ...row })),
    updatePublishFields: vi.fn(async (_o: string, _i: string, f: Record<string, unknown>) => {
      row = { ...row, ...f };
      return { ...row };
    }),
    _row: () => row,
  };
}

const JOB_BASE = {
  id: JOB,
  organizationId: ORG,
  productDescription: "Botox refresh",
  metaVideoId: null,
  metaCampaignId: null,
  metaAdSetId: null,
  metaCreativeId: null,
  metaAdId: null,
  metaPublishStatus: null,
};

function deps(
  over: {
    ads?: ReturnType<typeof makeAds>;
    store?: ReturnType<typeof makeStore>;
    pre?: unknown;
  } = {},
) {
  const ads = over.ads ?? makeAds();
  const store = over.store ?? makeStore(JOB_BASE);
  return {
    ads,
    store,
    d: {
      jobStore: store as never,
      assertPublishable: vi.fn().mockResolvedValue(
        over.pre ?? {
          ok: true,
          job: { id: JOB, organizationId: ORG, productDescription: "Botox refresh" },
          durableAssetUrl: "https://cdn.example/a.mp4",
          accessToken: "tok",
          accountId: "act_1",
          pageId: "page_1",
        },
      ),
      makeAdsClient: () => ads as never,
      fetchAsset: vi.fn().mockResolvedValue({ buffer: Buffer.from("x"), type: "video" as const }),
      failure: {} as never,
    },
  };
}

describe("executeCreativePublish", () => {
  it("creates the full paused draft package and persists all meta ids", async () => {
    const { d, ads, store } = deps();
    await executeCreativePublish({ jobId: JOB, organizationId: ORG }, step, d);
    expect(ads.uploadCreativeAsset).toHaveBeenCalledTimes(1);
    expect(ads.createDraftCampaign).toHaveBeenCalledTimes(1);
    expect(ads.createDraftAdSet).toHaveBeenCalledTimes(1);
    expect(ads.createAdCreative).toHaveBeenCalledTimes(1);
    expect(ads.createAd).toHaveBeenCalledTimes(1);
    expect(store._row().metaVideoId).toBe("vid_1");
    expect(store._row().metaAdId).toBe("ad_1");
    expect(store._row().metaPublishStatus).toBe(PARKED_PAUSED);
  });

  it("resumes a partial job: reuses video + campaign, no duplicate creates", async () => {
    const store = makeStore({ ...JOB_BASE, metaVideoId: "vid_1", metaCampaignId: "camp_1" });
    const { d, ads } = deps({ store });
    await executeCreativePublish({ jobId: JOB, organizationId: ORG }, step, d);
    expect(ads.uploadCreativeAsset).not.toHaveBeenCalled();
    expect(ads.createDraftCampaign).not.toHaveBeenCalled();
    expect(ads.createDraftAdSet).toHaveBeenCalledTimes(1);
    expect(ads.createAd).toHaveBeenCalledTimes(1);
  });

  it("throws NonRetriableError on a precondition failure (no Meta calls)", async () => {
    const { d, ads } = deps({
      pre: { ok: false, code: "CREATIVE_ASSET_NOT_DURABLE", message: "x" },
    });
    await expect(
      executeCreativePublish({ jobId: JOB, organizationId: ORG }, step, d),
    ).rejects.toMatchObject({ name: "NonRetriableError" });
    expect(ads.createAd).not.toHaveBeenCalled();
  });

  it("propagates a Meta error (retryable) and keeps the checkpoints written so far", async () => {
    const ads = makeAds();
    ads.createDraftAdSet.mockRejectedValueOnce(new Error("Meta API error (400): bad targeting"));
    const store = makeStore(JOB_BASE);
    const { d } = deps({ ads, store });
    await expect(
      executeCreativePublish({ jobId: JOB, organizationId: ORG }, step, d),
    ).rejects.toThrow(/Meta API error/);
    // A plain Error (not NonRetriableError) => Inngest retries; checkpoints persist.
    expect(store._row().metaVideoId).toBe("vid_1");
    expect(store._row().metaCampaignId).toBe("camp_1");
    expect(store._row().metaAdSetId).toBeNull();
  });

  it("dead-letter contract: Class B audit + creative.publish.failed, no alert", async () => {
    expect(CREATIVE_PUBLISH_FAILURE_PARAMS).toMatchObject({
      functionId: "creative-publish",
      eventDomain: "creative.publish",
      riskCategory: "medium",
      alert: false,
    });
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) };
    const inngest = { send: vi.fn().mockResolvedValue(undefined) };
    const operatorAlerter = { alert: vi.fn().mockResolvedValue(undefined) };
    const onFailure = makeOnFailureHandler(CREATIVE_PUBLISH_FAILURE_PARAMS, {
      auditLedger: auditLedger as never,
      operatorAlerter: operatorAlerter as never,
      inngest: inngest as never,
    });
    await onFailure({ error: new Error("boom"), event: { data: {} } } as never);
    expect(auditLedger.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "infrastructure.job.retry_exhausted" }),
    );
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "creative.publish.failed" }),
    );
    expect(operatorAlerter.alert).not.toHaveBeenCalled();
  });
});
