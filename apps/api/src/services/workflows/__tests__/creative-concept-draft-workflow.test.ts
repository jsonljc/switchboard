import { describe, it, expect, vi } from "vitest";
import { buildCreativeConceptDraftWorkflow } from "../creative-concept-draft-workflow.js";

const brief = { productDescription: "Botox for first-timers", targetAudience: "women 30-45" };

const workUnit = () => ({
  id: "wu-child",
  organizationId: "org-1",
  actor: { id: "dep-alex", type: "agent" as const },
  intent: "creative.concept.draft",
  parameters: { brief },
  deployment: {
    deploymentId: "dep-creative",
    skillSlug: "creative",
    trustLevel: "guided" as const,
    trustScore: 0,
  },
  resolvedMode: "workflow" as const,
  traceId: "trace-1",
  trigger: "internal" as const,
  priority: "normal" as const,
  requestedAt: new Date(),
});

const deps = (over: Record<string, unknown> = {}) => ({
  taskStore: { create: vi.fn().mockResolvedValue({ id: "task-1" }) },
  jobStore: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
  deploymentStore: { findById: vi.fn().mockResolvedValue({ listingId: "listing-1" }) },
  enablementStore: { list: vi.fn().mockResolvedValue([{ agentKey: "mira", status: "enabled" }]) },
  ...over,
});

const services = { submitChildWork: vi.fn() };

describe("creative.concept.draft workflow", () => {
  it("creates a draft job (task + creative job) and returns completed with jobId", async () => {
    const d = deps();
    const handler = buildCreativeConceptDraftWorkflow(d);
    const res = await handler.execute(workUnit(), services);

    expect(res.outcome).toBe("completed");
    expect(res.outputs).toMatchObject({ jobId: "job-1" });
    expect(d.taskStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-creative",
        organizationId: "org-1",
        listingId: "listing-1",
        category: "creative_strategy",
      }),
    );
    expect(d.jobStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        productDescription: "Botox for first-timers",
        targetAudience: "women 30-45",
      }),
    );
  });

  it("does NOT trigger any pipeline send (no spend) — handler has no inngest path", async () => {
    const d = deps();
    await buildCreativeConceptDraftWorkflow(d).execute(workUnit(), services);
    expect(d.jobStore.create).toHaveBeenCalledTimes(1);
    expect(services.submitChildWork).not.toHaveBeenCalled();
  });

  it("skips gracefully (completed + skipped flag) when Mira is not enabled", async () => {
    const d = deps({ enablementStore: { list: vi.fn().mockResolvedValue([]) } });
    const res = await buildCreativeConceptDraftWorkflow(d).execute(workUnit(), services);
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toMatchObject({ skipped: true, reason: "mira_not_enabled" });
    expect(d.taskStore.create).not.toHaveBeenCalled();
  });

  it("fails closed when no creative deployment resolves (listingId unavailable)", async () => {
    const d = deps({ deploymentStore: { findById: vi.fn().mockResolvedValue(null) } });
    const res = await buildCreativeConceptDraftWorkflow(d).execute(workUnit(), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("DEPLOYMENT_NOT_FOUND");
    expect(d.taskStore.create).not.toHaveBeenCalled();
  });
});
