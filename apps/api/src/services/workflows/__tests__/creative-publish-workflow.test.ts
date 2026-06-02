import { describe, it, expect, vi } from "vitest";
import { buildCreativePublishWorkflow } from "../creative-publish-workflow.js";

const ORG = "org_1";
const JOB_BASE = {
  id: "j1",
  organizationId: ORG,
  productDescription: "Botox refresh",
  currentStage: "complete",
  stoppedAt: null,
  reviewDecision: "kept",
  durableAssetUrl: "https://cdn.example/a.mp4",
  metaVideoId: null,
  metaCampaignId: null,
  metaAdSetId: null,
  metaCreativeId: null,
  metaAdId: null,
  metaPublishStatus: null,
};

function workUnit() {
  return { organizationId: ORG, parameters: { jobId: "j1" } } as never;
}

function makeAds() {
  return {
    uploadCreativeAsset: vi.fn().mockResolvedValue({ id: "vid_1", url: "u" }),
    createDraftCampaign: vi.fn().mockResolvedValue({ id: "camp_1" }),
    createDraftAdSet: vi.fn().mockResolvedValue({ id: "set_1" }),
    createAdCreative: vi.fn().mockResolvedValue({ id: "cr_1" }),
    createAd: vi.fn().mockResolvedValue({ id: "ad_1" }),
  };
}

/** Mutable job store mirroring findById/updatePublishFields against an in-memory row. */
function makeStore(initial: Record<string, unknown>) {
  let row = { ...initial };
  return {
    findById: vi.fn(async () => ({ ...row })),
    updatePublishFields: vi.fn(
      async (_org: string, _id: string, fields: Record<string, unknown>) => {
        row = { ...row, ...fields };
        return { ...row };
      },
    ),
    _row: () => row,
  };
}

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
    handler: buildCreativePublishWorkflow({
      jobStore: store as never,
      assertPublishable: vi.fn().mockResolvedValue(
        over.pre ?? {
          ok: true,
          job: store._row(),
          durableAssetUrl: "https://cdn.example/a.mp4",
          accessToken: "tok",
          accountId: "act_1",
          pageId: "page_1",
        },
      ),
      makeAdsClient: () => ads as never,
      fetchAsset: vi.fn().mockResolvedValue({ buffer: Buffer.from("x"), type: "video" }),
    }),
  };
}

describe("buildCreativePublishWorkflow", () => {
  it("creates the full paused draft package and persists all meta ids", async () => {
    const { handler, ads, store } = deps();
    const res = await handler.execute(workUnit(), {} as never);

    expect(res.outcome).toBe("completed");
    // Copy discipline (spec §4.5): a paused draft to finalize in Ads Manager —
    // never framed as "published" / "live".
    const summary = res.summary.toLowerCase();
    expect(summary).toContain("paused");
    expect(summary).toContain("draft");
    expect(summary).toContain("ads manager");
    expect(summary).not.toContain("published");
    expect(ads.uploadCreativeAsset).toHaveBeenCalledTimes(1);
    expect(ads.createDraftCampaign).toHaveBeenCalledTimes(1);
    expect(ads.createDraftAdSet).toHaveBeenCalledTimes(1);
    expect(ads.createAdCreative).toHaveBeenCalledTimes(1);
    expect(ads.createAd).toHaveBeenCalledTimes(1);
    expect(ads.createDraftCampaign.mock.calls[0]![0].budget).toBeDefined();
    expect(store._row().metaAdId).toBe("ad_1");
    expect(store._row().metaPublishStatus).toBe("parked_paused");
  });

  it("short-circuits a fully-parked job with zero Meta calls", async () => {
    const store = makeStore({ ...JOB_BASE, metaAdId: "ad_1", metaPublishStatus: "parked_paused" });
    const { handler, ads } = deps({ store });
    const res = await handler.execute(workUnit(), {} as never);
    expect(res.outcome).toBe("completed");
    expect(ads.uploadCreativeAsset).not.toHaveBeenCalled();
    expect(ads.createAd).not.toHaveBeenCalled();
  });

  it("resumes a partial job: reuses the existing campaign, no duplicate", async () => {
    const store = makeStore({ ...JOB_BASE, metaVideoId: "vid_1", metaCampaignId: "camp_1" });
    const { handler, ads } = deps({ store });
    const res = await handler.execute(workUnit(), {} as never);
    expect(res.outcome).toBe("completed");
    expect(ads.uploadCreativeAsset).not.toHaveBeenCalled(); // metaVideoId present
    expect(ads.createDraftCampaign).not.toHaveBeenCalled(); // metaCampaignId present
    expect(ads.createDraftAdSet).toHaveBeenCalledTimes(1);
    expect(ads.createAd).toHaveBeenCalledTimes(1);
  });

  it("returns CREATIVE_PUBLISH_META_ERROR when a Meta call fails (checkpoints persisted)", async () => {
    const ads = makeAds();
    ads.createDraftAdSet.mockRejectedValueOnce(new Error("Meta API error (400): bad targeting"));
    const store = makeStore(JOB_BASE);
    const { handler } = deps({ ads, store });
    const res = await handler.execute(workUnit(), {} as never);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_PUBLISH_META_ERROR");
    expect(store._row().metaVideoId).toBe("vid_1");
    expect(store._row().metaCampaignId).toBe("camp_1");
    expect(store._row().metaAdSetId).toBeNull();
  });

  it("returns the precheck failure code defensively (no Meta calls)", async () => {
    const ads = makeAds();
    const { handler } = deps({
      ads,
      pre: { ok: false, code: "CREATIVE_ASSET_NOT_DURABLE", message: "x" },
    });
    const res = await handler.execute(workUnit(), {} as never);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_ASSET_NOT_DURABLE");
    expect(ads.createAd).not.toHaveBeenCalled();
  });
});
