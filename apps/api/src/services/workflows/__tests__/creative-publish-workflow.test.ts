import { describe, it, expect, beforeEach, vi } from "vitest";

const { inngestSend } = vi.hoisted(() => ({ inngestSend: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@switchboard/creative-pipeline", () => ({ inngestClient: { send: inngestSend } }));

const { buildCreativePublishWorkflow } = await import("../creative-publish-workflow.js");

const ORG = "org_1";
const JOB = "j1";

function makeStore(row: Record<string, unknown> | null) {
  return { findById: vi.fn(async () => (row ? { ...row } : null)) };
}
function workUnit(organizationId = ORG) {
  return { id: "wu_1", organizationId, parameters: { jobId: JOB } } as never;
}
const PENDING = {
  id: JOB,
  organizationId: ORG,
  metaAdId: null,
  metaPublishStatus: null,
};

describe("buildCreativePublishWorkflow (dispatcher)", () => {
  beforeEach(() => inngestSend.mockClear());

  it("dispatches publish.requested and returns queued for a pending job", async () => {
    const store = makeStore(PENDING);
    const res = await buildCreativePublishWorkflow({ jobStore: store as never }).execute(
      workUnit(),
      {} as never,
    );
    expect(inngestSend).toHaveBeenCalledWith({
      name: "creative-pipeline/publish.requested",
      data: { jobId: JOB, organizationId: ORG, workUnitId: "wu_1" },
    });
    expect(res.outcome).toBe("queued");
    expect(res.outputs).toMatchObject({ jobId: JOB });
    // Copy discipline (spec 4.5): a paused draft, never "published" / "live".
    const s = res.summary.toLowerCase();
    expect(s).toContain("paused");
    expect(s).toContain("draft");
    expect(s).not.toContain("published");
  });

  it("short-circuits an already-parked job (completed, no dispatch)", async () => {
    const store = makeStore({ ...PENDING, metaAdId: "ad_1", metaPublishStatus: "parked_paused" });
    const res = await buildCreativePublishWorkflow({ jobStore: store as never }).execute(
      workUnit(),
      {} as never,
    );
    expect(res.outcome).toBe("completed");
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("missing job -> failed CREATIVE_JOB_NOT_FOUND, no dispatch", async () => {
    const res = await buildCreativePublishWorkflow({ jobStore: makeStore(null) as never }).execute(
      workUnit(),
      {} as never,
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_JOB_NOT_FOUND");
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("cross-org job -> failed CREATIVE_JOB_NOT_FOUND, no dispatch", async () => {
    const store = makeStore(PENDING); // owned by ORG
    const res = await buildCreativePublishWorkflow({ jobStore: store as never }).execute(
      workUnit("org_intruder"),
      {} as never,
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_JOB_NOT_FOUND");
    expect(inngestSend).not.toHaveBeenCalled();
  });
});
