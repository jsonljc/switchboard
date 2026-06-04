/**
 * P2a-ii — `creative.job.submit` workflow handler.
 *
 * After routing POST /creative-jobs through PlatformIngress, the AgentTask +
 * CreativeJob create AND the `creative-pipeline/job.submitted` Inngest kick live
 * here (post-governance), not on the route. These tests lock that behaviour for
 * both polished and UGC modes and confirm the `{ task, job }` output the route
 * maps back to its 201 response.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { taskCreate, jobCreate, jobCreateUgc, jobListPublished, inngestSend } = vi.hoisted(() => ({
  taskCreate: vi.fn(),
  jobCreate: vi.fn(),
  jobCreateUgc: vi.fn(),
  jobListPublished: vi.fn(),
  inngestSend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@switchboard/db", () => ({
  PrismaAgentTaskStore: class {
    create = taskCreate;
  },
  PrismaCreativeJobStore: class {
    create = jobCreate;
    createUgc = jobCreateUgc;
    listPublished = jobListPublished;
  },
}));

vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { send: inngestSend },
  // Used by the measured-history enrichment (buildPerformanceHistory).
  extractCreativeDescriptor: () => ({ mode: "polished", hookType: "question" }),
}));

const { buildCreativeJobSubmitWorkflow } = await import("../creative-job-submit-workflow.js");

const ORG = "org-acme";

const brief = {
  productDescription: "Botox first-timer offer",
  targetAudience: "women 30-45",
  platforms: ["meta"],
  brandVoice: null,
  productImages: [],
  references: [],
  pastPerformance: null,
  generateReferenceImages: false,
};

function workUnit(mode: "polished" | "ugc") {
  return {
    id: "wu-1",
    organizationId: ORG,
    actor: { id: "user-1", type: "user" as const },
    intent: "creative.job.submit",
    parameters: { deploymentId: "dep-1", listingId: "lst-1", brief, mode },
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "creative",
      trustLevel: "guided" as const,
      trustScore: 0,
    },
    resolvedMode: "workflow" as const,
    traceId: "trace-1",
    trigger: "api" as const,
    priority: "normal" as const,
    requestedAt: new Date("2026-06-02").toISOString(),
  };
}

const services = { submitChildWork: vi.fn() };

describe("creative.job.submit workflow", () => {
  beforeEach(() => {
    taskCreate.mockReset().mockResolvedValue({ id: "task-1" });
    jobCreate.mockReset().mockResolvedValue({ id: "job-1", mode: "polished" });
    jobCreateUgc.mockReset().mockResolvedValue({ id: "job-ugc-1", mode: "ugc" });
    jobListPublished.mockReset().mockResolvedValue([]);
    inngestSend.mockClear();
  });

  it("polished → creates task + job and fires job.submitted, returns {task, job}", async () => {
    const res = await buildCreativeJobSubmitWorkflow({}).execute(workUnit("polished"), services);

    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-1",
        organizationId: ORG,
        listingId: "lst-1",
        category: "creative_strategy",
      }),
    );
    expect(jobCreate).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", organizationId: ORG, deploymentId: "dep-1" }),
    );
    expect(jobCreateUgc).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledWith({
      name: "creative-pipeline/job.submitted",
      data: {
        jobId: "job-1",
        taskId: "task-1",
        organizationId: ORG,
        deploymentId: "dep-1",
        mode: "polished",
      },
    });
    expect(res.outcome).toBe("queued");
    expect(res.outputs).toEqual({ task: { id: "task-1" }, job: { id: "job-1", mode: "polished" } });
  });

  it("ugc → uses createUgc (not create) and fires job.submitted with mode ugc", async () => {
    const res = await buildCreativeJobSubmitWorkflow({}).execute(workUnit("ugc"), services);

    expect(jobCreateUgc).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", ugcConfig: expect.any(Object) }),
    );
    expect(jobCreate).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "creative-pipeline/job.submitted",
        data: expect.objectContaining({ jobId: "job-ugc-1", mode: "ugc" }),
      }),
    );
    expect(res.outputs).toMatchObject({ job: { id: "job-ugc-1" } });
  });

  describe("slice-2 measured-history enrichment", () => {
    const MEASURED = {
      kind: "measured_performance",
      version: 1,
      asOf: "2026-06-04T06:30:00.000Z",
      window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z", days: 30 },
      delivery: "measured",
      join: { metaCampaignId: "camp-1", metaAdId: null, metaVideoId: null },
      meta: {
        spend: 50,
        impressions: 1000,
        inlineLinkClicks: 40,
        inlineLinkClickCtr: 4,
        conversions: 3,
        cpm: 50,
      },
      booked: { valueCents: 25000, count: 2 },
      trueRoas: 5,
      source: { insights: "meta_campaign_insights", conversions: "conversion_records" },
    };

    function publishedJob(deploymentId: string) {
      return {
        id: "older-1",
        organizationId: ORG,
        deploymentId,
        mode: "polished",
        stageOutputs: {},
        pastPerformance: MEASURED,
        metaCampaignId: "camp-1",
        createdAt: new Date("2026-05-04"),
        updatedAt: new Date("2026-05-04"),
      };
    }

    it("null brief.pastPerformance + measured history on the SAME deployment → enriched typed history", async () => {
      jobListPublished.mockResolvedValue([
        publishedJob("dep-1"),
        publishedJob("dep-other"), // different deployment: excluded
      ]);

      await buildCreativeJobSubmitWorkflow({}).execute(workUnit("polished"), services);

      expect(jobListPublished).toHaveBeenCalledWith(ORG);
      const created = jobCreate.mock.calls[0]![0] as { pastPerformance: unknown };
      expect(created.pastPerformance).toMatchObject({
        kind: "performance_history",
        topPerformers: [expect.objectContaining({ jobId: "older-1", trueRoas: 5 })],
      });
      expect((created.pastPerformance as { topPerformers: unknown[] }).topPerformers).toHaveLength(
        1,
      );
    });

    it("an explicit caller-passed pastPerformance WINS over enrichment", async () => {
      jobListPublished.mockResolvedValue([publishedJob("dep-1")]);
      const explicit = { caller: "context" };
      const wu = workUnit("polished");
      (wu.parameters as { brief: Record<string, unknown> }).brief = {
        ...brief,
        pastPerformance: explicit,
      };

      await buildCreativeJobSubmitWorkflow({}).execute(wu, services);

      expect(jobListPublished).not.toHaveBeenCalled();
      const created = jobCreate.mock.calls[0]![0] as { pastPerformance: unknown };
      expect(created.pastPerformance).toEqual(explicit);
    });

    it("enrichment failure is best-effort: the job is still created with null", async () => {
      jobListPublished.mockRejectedValue(new Error("db down"));

      const res = await buildCreativeJobSubmitWorkflow({}).execute(workUnit("polished"), services);

      const created = jobCreate.mock.calls[0]![0] as { pastPerformance: unknown };
      expect(created.pastPerformance).toBeNull();
      expect(res.outcome).toBe("queued");
    });

    it("no measured history → pastPerformance stays null (no fabricated history)", async () => {
      jobListPublished.mockResolvedValue([]);

      await buildCreativeJobSubmitWorkflow({}).execute(workUnit("polished"), services);

      const created = jobCreate.mock.calls[0]![0] as { pastPerformance: unknown };
      expect(created.pastPerformance).toBeNull();
    });
  });
});
