import { describe, it, expect, vi } from "vitest";
import { assertPublishable } from "../creative-publish-preconditions.js";

const KEPT_JOB = {
  id: "j1",
  organizationId: "org_1",
  currentStage: "complete",
  stoppedAt: null,
  reviewDecision: "kept",
  durableAssetUrl: "https://cdn.example/a.mp4",
};

const META_CONNECTION = {
  credentials: "enc-meta",
  externalAccountId: "act_1",
  status: "connected",
};

function deps(
  overrides: {
    job?: unknown;
    connection?: unknown;
    creds?: Record<string, unknown>;
  } = {},
) {
  const findFirst = vi
    .fn()
    .mockResolvedValue("connection" in overrides ? overrides.connection : META_CONNECTION);
  const decrypt = vi
    .fn()
    .mockReturnValue(
      overrides.creds ?? { accessToken: "tok", accountId: "act_1", pageId: "page_1" },
    );
  return {
    prisma: {
      creativeJob: {
        findUnique: vi.fn().mockResolvedValue("job" in overrides ? overrides.job : KEPT_JOB),
      },
      connection: { findFirst },
    },
    decrypt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("assertPublishable", () => {
  it("returns ok with resolved context for a complete, kept job with conn + page", async () => {
    const r = await assertPublishable(deps(), "org_1", "j1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pageId).toBe("page_1");
      expect(r.accessToken).toBe("tok");
      expect(r.durableAssetUrl).toBe("https://cdn.example/a.mp4");
    }
  });

  it("a connected Meta-Ads org with NO WhatsApp/WABA binding can publish (regression: unconditional WABA check blocked non-CTWA orgs)", async () => {
    // This is the regression test: the publish path is LEARN_MORE / OUTCOME_LEADS,
    // not a click-to-WhatsApp ad. An org that has Meta Ads but has not completed
    // WhatsApp onboarding must still be able to publish a normal creative.
    const r = await assertPublishable(deps(), "org_1", "j1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.accessToken).toBe("tok");
      expect(r.pageId).toBe("page_1");
    }
  });

  it("a completed, kept UGC job with a durable asset is publishable (slice-3 spec 3.3f)", async () => {
    // UGC jobs never advance currentStage (stays the "trends" column default);
    // completeness keys off ugcPhase for them. Without the mode-aware check,
    // 3.3f's durable URL was unreachable through publish.
    const r = await assertPublishable(
      deps({
        job: {
          ...KEPT_JOB,
          mode: "ugc",
          currentStage: "trends",
          ugcPhase: "complete",
          ugcFailure: null,
        },
      }),
      "org_1",
      "j1",
    );
    expect(r.ok).toBe(true);
  });

  it("an in-flight UGC job is not publishable", async () => {
    const r = await assertPublishable(
      deps({
        job: {
          ...KEPT_JOB,
          mode: "ugc",
          currentStage: "trends",
          ugcPhase: "production",
          ugcFailure: null,
        },
      }),
      "org_1",
      "j1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CREATIVE_NOT_PUBLISHABLE");
  });

  it("a failed UGC job is not publishable even at ugcPhase complete-adjacent states", async () => {
    const r = await assertPublishable(
      deps({
        job: {
          ...KEPT_JOB,
          mode: "ugc",
          currentStage: "trends",
          ugcPhase: "complete",
          ugcFailure: { code: "PHASE_EXECUTION_FAILED" },
        },
      }),
      "org_1",
      "j1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CREATIVE_NOT_PUBLISHABLE");
  });

  it("CREATIVE_JOB_NOT_FOUND for a missing job", async () => {
    const r = await assertPublishable(deps({ job: null }), "org_1", "j1");
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_JOB_NOT_FOUND" });
  });

  it("CREATIVE_JOB_NOT_FOUND for a cross-org job", async () => {
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, organizationId: "other" } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_JOB_NOT_FOUND" });
  });

  it("CREATIVE_NOT_PUBLISHABLE when not complete", async () => {
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, currentStage: "storyboard" } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_NOT_PUBLISHABLE" });
  });

  it("CREATIVE_NOT_PUBLISHABLE when not human-kept", async () => {
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, reviewDecision: null } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_NOT_PUBLISHABLE" });
  });

  it("CREATIVE_ASSET_NOT_DURABLE when durableAssetUrl is null", async () => {
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, durableAssetUrl: null } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_ASSET_NOT_DURABLE" });
  });

  it("META_CONNECTION_NOT_FOUND when no meta-ads connection", async () => {
    const r = await assertPublishable(deps({ connection: null }), "org_1", "j1");
    expect(r).toMatchObject({ ok: false, code: "META_CONNECTION_NOT_FOUND" });
  });

  it("META_CONNECTION_NOT_FOUND when creds lack token/account", async () => {
    const r = await assertPublishable(deps({ creds: { pageId: "page_1" } }), "org_1", "j1");
    expect(r).toMatchObject({ ok: false, code: "META_CONNECTION_NOT_FOUND" });
  });

  it("META_PAGE_NOT_CONFIGURED when no pageId resolvable", async () => {
    const r = await assertPublishable(
      deps({ creds: { accessToken: "tok", accountId: "act_1" } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "META_PAGE_NOT_CONFIGURED" });
  });

  it("META_CONNECTION_NOT_CONNECTED when the meta-ads connection is not connected", async () => {
    // An expired/revoked connection must fail pre-flight with a clear, actionable
    // reason -- NOT a raw downstream Meta error after a dead-letter. The reason
    // names the actual status so the operator knows to reconnect.
    const r = await assertPublishable(
      deps({ connection: { ...META_CONNECTION, status: "expired" } }),
      "org_1",
      "j1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("META_CONNECTION_NOT_CONNECTED");
      expect(r.message).toContain("expired");
      // It must be our own actionable copy, never a raw Meta API error string.
      expect(r.message).not.toMatch(/OAuthException|graph\.facebook\.com|#\d{2,}/);
    }
  });

  it("META_CONNECTION_NOT_CONNECTED defaults its status word when status is missing", async () => {
    const r = await assertPublishable(
      deps({ connection: { credentials: "enc-meta", externalAccountId: "act_1" } }),
      "org_1",
      "j1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("META_CONNECTION_NOT_CONNECTED");
  });

  it("loop-closing: accepts a PR-A storage URL and surfaces the exact value to the handler", async () => {
    const url = "https://cdn.example.com/creative-assets/job_1/abc.mp4";
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, durableAssetUrl: url } }),
      "org_1",
      "j1",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.durableAssetUrl).toBe(url);
    }
  });
});
