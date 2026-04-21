import { describe, expect, it, vi } from "vitest";
import { IntentRegistry, ExecutionModeRegistry } from "@switchboard/core/platform";

vi.mock("../../services/workflows/creative-job-submit-workflow.js", () => ({
  buildCreativeJobSubmitWorkflow: () => ({ execute: vi.fn() }),
}));
vi.mock("../../services/workflows/creative-job-decision-workflow.js", () => ({
  buildCreativeJobDecisionWorkflow: () => ({ execute: vi.fn() }),
}));
vi.mock("../../services/workflows/meta-lead-intake-workflow.js", () => ({
  buildMetaLeadIntakeWorkflow: () => ({ execute: vi.fn() }),
}));
vi.mock("../../services/workflows/meta-lead-greeting-workflow.js", () => ({
  buildMetaLeadGreetingWorkflow: () => ({ execute: vi.fn() }),
}));
vi.mock("../../services/workflows/meta-lead-record-inquiry-workflow.js", () => ({
  buildMetaLeadRecordInquiryWorkflow: () => ({ execute: vi.fn() }),
}));

describe("bootstrapContainedWorkflows", () => {
  it("registers the workflow mode and workflow intents", async () => {
    const { bootstrapContainedWorkflows } = await import("../contained-workflows.js");
    const intentRegistry = new IntentRegistry();
    const modeRegistry = new ExecutionModeRegistry();

    await bootstrapContainedWorkflows({
      prismaClient: {} as never,
      intentRegistry,
      modeRegistry,
      platformIngress: { submit: vi.fn() } as never,
      deploymentResolver: null,
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    expect(modeRegistry.hasMode("workflow")).toBe(true);
    expect(intentRegistry.lookup("creative.job.submit")).toBeDefined();
    expect(intentRegistry.lookup("creative.job.continue")).toBeDefined();
    expect(intentRegistry.lookup("creative.job.stop")).toBeDefined();
    expect(intentRegistry.lookup("meta.lead.intake")).toBeDefined();
    expect(intentRegistry.lookup("meta.lead.greeting.send")).toBeDefined();
    expect(intentRegistry.lookup("meta.lead.inquiry.record")).toBeDefined();
  });

  it("registers workflow intents with correct trigger policies", async () => {
    const { bootstrapContainedWorkflows } = await import("../contained-workflows.js");
    const intentRegistry = new IntentRegistry();
    const modeRegistry = new ExecutionModeRegistry();

    await bootstrapContainedWorkflows({
      prismaClient: {} as never,
      intentRegistry,
      modeRegistry,
      platformIngress: { submit: vi.fn() } as never,
      deploymentResolver: null,
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    const creativeSubmit = intentRegistry.lookup("creative.job.submit")!;
    expect(creativeSubmit.allowedTriggers).toContain("api");
    expect(creativeSubmit.budgetClass).toBe("expensive");

    const leadIntake = intentRegistry.lookup("meta.lead.intake")!;
    expect(leadIntake.allowedTriggers).toContain("internal");
    expect(leadIntake.approvalPolicy).toBe("none");
  });
});
