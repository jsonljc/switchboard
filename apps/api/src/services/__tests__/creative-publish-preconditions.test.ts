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

function deps(
  overrides: {
    job?: unknown;
    connection?: unknown;
    creds?: Record<string, unknown>;
  } = {},
) {
  return {
    prisma: {
      creativeJob: {
        findUnique: vi.fn().mockResolvedValue("job" in overrides ? overrides.job : KEPT_JOB),
      },
      connection: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            "connection" in overrides
              ? overrides.connection
              : { credentials: "enc", externalAccountId: "act_1" },
          ),
      },
    },
    decrypt: vi
      .fn()
      .mockReturnValue(
        overrides.creds ?? { accessToken: "tok", accountId: "act_1", pageId: "page_1" },
      ),
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
