import { describe, it, expect, vi } from "vitest";

const { inngestCreateFunction } = vi.hoisted(() => ({
  inngestCreateFunction: vi.fn((_cfg: unknown, _handler: unknown) => ({ id: "creative-publish" })),
}));
vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { createFunction: inngestCreateFunction },
}));

const {
  executeCreativePublish,
  reconcilePublishTraceCompleted,
  CREATIVE_PUBLISH_FAILURE_PARAMS,
  PARKED_PAUSED,
  PAUSED_DRAFT_SUMMARY,
} = await import("../creative-publish-function.js");
const { makeOnFailureHandler } = await import("@switchboard/core");

const ORG = "org_1";
const JOB = "job_1";
const WU = "wu_1";

/** step.run mock: invokes the callback and returns its value (no Inngest memoization). */
const step = { run: async (_id: string, fn: () => unknown) => fn() } as never;

type TraceShape = {
  outcome: string;
  organizationId?: string;
  intent?: string;
  parameters?: Record<string, unknown>;
};

const QUEUED_PUBLISH_TRACE: TraceShape = {
  outcome: "queued",
  organizationId: ORG,
  intent: "creative.job.publish",
  parameters: { jobId: JOB },
};

/** WorkTraceStore subset the success reconcile uses; update returns the prod ok-shape. */
function makeTraceStore(trace: TraceShape | null = QUEUED_PUBLISH_TRACE) {
  return {
    getByWorkUnitId: vi.fn(
      async (): Promise<unknown> => (trace ? { trace, integrity: { status: "ok" } } : null),
    ),
    update: vi.fn(
      async (): Promise<unknown> => ({
        ok: true,
        trace: { ...(trace ?? {}), outcome: "completed" },
      }),
    ),
  };
}

/** The four meta ids makeAds() yields, in the dispatcher short-circuit's output shape. */
const PARKED_OUTPUTS = {
  metaAdId: "ad_1",
  metaAdSetId: "set_1",
  metaCreativeId: "cr_1",
  metaCampaignId: "camp_1",
} as const;

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
    traceStore?: ReturnType<typeof makeTraceStore> | null;
  } = {},
) {
  const ads = over.ads ?? makeAds();
  const store = over.store ?? makeStore(JOB_BASE);
  const traceStore = over.traceStore === undefined ? null : over.traceStore;
  return {
    ads,
    store,
    traceStore,
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
      traceStore: traceStore as never,
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

  it("shapes the draft package for the CTWA WhatsApp funnel (objective immutable post-create)", async () => {
    // Meta objectives are IMMUTABLE after create, so the published package MUST be born
    // in CTWA shape or it can never serve the WhatsApp click-to-message funnel:
    //  - campaign: OUTCOME_ENGAGEMENT + special_ad_categories present (Meta requires it).
    //  - ad set: destination_type WHATSAPP + promoted_object{ page_id } (threaded from the
    //    connection/org config, never hardcoded) + a billing_event + age_min:18 targeting.
    //  - creative: a WHATSAPP_MESSAGE call to action.
    const { d, ads } = deps();
    await executeCreativePublish({ jobId: JOB, organizationId: ORG }, step, d);

    const campaign = ads.createDraftCampaign.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(campaign.objective).toBe("OUTCOME_ENGAGEMENT");
    expect(campaign.specialAdCategories).toEqual([]);

    const adSet = ads.createDraftAdSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(adSet.destinationType).toBe("WHATSAPP");
    // pageId is threaded from the resolved publish context (config), not a literal.
    expect(adSet.promotedObject).toEqual({ page_id: "page_1" });
    expect(adSet.billingEvent).toBeDefined();
    expect((adSet.targeting as Record<string, unknown>).age_min).toBe(18);

    const creative = ads.createAdCreative.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(creative.callToActionType).toBe("WHATSAPP_MESSAGE");
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
    // A transient Meta failure (rate limit / 5xx / network) propagates as a plain Error so
    // Inngest retries it (vs a precondition failure, which throws NonRetriableError).
    ads.createDraftAdSet.mockRejectedValueOnce(new Error("Meta API error (429): rate limited"));
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

  it("dead-letter contract: audit + creative.publish.failed event + operator warning alert", async () => {
    // A human-approved publish whose Meta chain dead-letters has a named owner;
    // it alerts at warning severity (the paused draft carries no live spend, so
    // not critical). The dead-letter event still fires for the publish-failure
    // recorder to mark metaPublishStatus.
    expect(CREATIVE_PUBLISH_FAILURE_PARAMS).toMatchObject({
      functionId: "creative-publish",
      eventDomain: "creative.publish",
      riskCategory: "medium",
      alert: true,
      severity: "warning",
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
    expect(operatorAlerter.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        errorType: "async_job_retry_exhausted",
      }),
    );
  });

  it("reconciles the canonical work trace queued -> completed once the draft parks", async () => {
    const traceStore = makeTraceStore();
    const { d } = deps({ traceStore });
    await executeCreativePublish({ jobId: JOB, organizationId: ORG, workUnitId: WU }, step, d);
    expect(traceStore.getByWorkUnitId).toHaveBeenCalledWith(WU);
    expect(traceStore.update).toHaveBeenCalledWith(
      WU,
      expect.objectContaining({
        outcome: "completed",
        executionSummary: PAUSED_DRAFT_SUMMARY,
        executionOutputs: PARKED_OUTPUTS,
        completedAt: expect.any(String),
      }),
      { caller: "creative-publish", organizationId: ORG },
    );
  });

  it("does not reconcile the trace when the event carries no workUnitId (back-compat)", async () => {
    const traceStore = makeTraceStore();
    const { d } = deps({ traceStore });
    await executeCreativePublish({ jobId: JOB, organizationId: ORG }, step, d);
    expect(traceStore.getByWorkUnitId).not.toHaveBeenCalled();
    expect(traceStore.update).not.toHaveBeenCalled();
  });

  it("degrades to no trace reconcile when no trace store is wired", async () => {
    const { d, store } = deps({ traceStore: null });
    await executeCreativePublish({ jobId: JOB, organizationId: ORG, workUnitId: WU }, step, d);
    // The publish itself still parks the draft.
    expect(store._row().metaAdId).toBe("ad_1");
    expect(store._row().metaPublishStatus).toBe(PARKED_PAUSED);
  });
});

describe("reconcilePublishTraceCompleted", () => {
  const ARGS = {
    workUnitId: WU,
    organizationId: ORG,
    jobId: JOB,
    outputs: PARKED_OUTPUTS,
    completedAt: "2026-06-13T00:00:00.000Z",
  };

  it("reconciles a queued publish trace to completed, carrying outputs + summary + completedAt", async () => {
    const traceStore = makeTraceStore();
    await reconcilePublishTraceCompleted(traceStore as never, ARGS);
    expect(traceStore.getByWorkUnitId).toHaveBeenCalledWith(WU);
    expect(traceStore.update).toHaveBeenCalledWith(
      WU,
      {
        outcome: "completed",
        executionSummary: PAUSED_DRAFT_SUMMARY,
        executionOutputs: PARKED_OUTPUTS,
        completedAt: "2026-06-13T00:00:00.000Z",
      },
      { caller: "creative-publish", organizationId: ORG },
    );
  });

  it("refuses a cross-tenant reconcile when the trace org != the job org", async () => {
    const traceStore = makeTraceStore({ ...QUEUED_PUBLISH_TRACE, organizationId: "org_B" });
    await reconcilePublishTraceCompleted(traceStore as never, ARGS);
    expect(traceStore.update).not.toHaveBeenCalled();
  });

  it("refuses a wrong-action reconcile when the trace intent != creative.job.publish", async () => {
    const traceStore = makeTraceStore({ ...QUEUED_PUBLISH_TRACE, intent: "creative.job.submit" });
    await reconcilePublishTraceCompleted(traceStore as never, ARGS);
    expect(traceStore.update).not.toHaveBeenCalled();
  });

  it("refuses a wrong-job reconcile when the trace parameters.jobId != the loaded job", async () => {
    const traceStore = makeTraceStore({
      ...QUEUED_PUBLISH_TRACE,
      parameters: { jobId: "job_other" },
    });
    await reconcilePublishTraceCompleted(traceStore as never, ARGS);
    expect(traceStore.update).not.toHaveBeenCalled();
  });

  it("no-ops when the trace already reached completed (idempotent re-delivery)", async () => {
    const traceStore = makeTraceStore({ ...QUEUED_PUBLISH_TRACE, outcome: "completed" });
    await reconcilePublishTraceCompleted(traceStore as never, ARGS);
    expect(traceStore.update).not.toHaveBeenCalled();
  });

  it("no-ops when the trace already reached failed (a dead-letter won the race; no clobber)", async () => {
    const traceStore = makeTraceStore({ ...QUEUED_PUBLISH_TRACE, outcome: "failed" });
    await reconcilePublishTraceCompleted(traceStore as never, ARGS);
    expect(traceStore.update).not.toHaveBeenCalled();
  });

  it("warns and no-ops when the WorkTrace is missing", async () => {
    const traceStore = makeTraceStore(null);
    await reconcilePublishTraceCompleted(traceStore as never, ARGS);
    expect(traceStore.getByWorkUnitId).toHaveBeenCalledWith(WU);
    expect(traceStore.update).not.toHaveBeenCalled();
  });

  it("tolerates a locked trace, production shape ({ ok: false }), without throwing", async () => {
    const traceStore = makeTraceStore();
    traceStore.update = vi.fn(async () => ({
      ok: false,
      code: "WORK_TRACE_LOCKED",
      traceUnchanged: true,
      reason: "locked",
    }));
    await expect(
      reconcilePublishTraceCompleted(traceStore as never, ARGS),
    ).resolves.toBeUndefined();
  });

  it("tolerates a locked trace, non-production shape (WorkTraceLockedError throw), without escaping", async () => {
    const traceStore = makeTraceStore();
    traceStore.update = vi.fn(async () => {
      throw Object.assign(new Error("Trace locked"), { code: "WORK_TRACE_LOCKED" });
    });
    await expect(
      reconcilePublishTraceCompleted(traceStore as never, ARGS),
    ).resolves.toBeUndefined();
  });

  it("propagates an unexpected trace-store error so Inngest can retry", async () => {
    const traceStore = makeTraceStore();
    traceStore.update = vi.fn(async () => {
      throw new Error("connection reset");
    });
    await expect(reconcilePublishTraceCompleted(traceStore as never, ARGS)).rejects.toThrow(
      "connection reset",
    );
  });

  it("omits completedAt from the update when not supplied", async () => {
    const traceStore = makeTraceStore();
    const { completedAt: _drop, ...argsNoTime } = ARGS;
    await reconcilePublishTraceCompleted(traceStore as never, argsNoTime);
    // Exact-match: an extra completedAt key would fail the deep-equal.
    expect(traceStore.update).toHaveBeenCalledWith(
      WU,
      {
        outcome: "completed",
        executionSummary: PAUSED_DRAFT_SUMMARY,
        executionOutputs: PARKED_OUTPUTS,
      },
      { caller: "creative-publish", organizationId: ORG },
    );
  });
});
