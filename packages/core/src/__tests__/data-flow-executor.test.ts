import { describe, it, expect, vi, beforeEach } from "vitest";
import { DataFlowExecutor } from "../data-flow/executor.js";
import type { DataFlowOrchestrator } from "../data-flow/executor.js";
import type { DataFlowPlan } from "../data-flow/types.js";

function createPlan(overrides: Partial<DataFlowPlan> = {}): DataFlowPlan {
  return {
    id: "plan_1",
    envelopeId: "env_plan_1",
    strategy: "sequential",
    approvalMode: "per_action",
    summary: "Test plan",
    steps: [],
    deferredBindings: true,
    ...overrides,
  };
}

describe("DataFlowExecutor", () => {
  let orchestrator: DataFlowOrchestrator;
  let executor: DataFlowExecutor;

  beforeEach(() => {
    orchestrator = {
      propose: vi.fn().mockResolvedValue({
        denied: false,
        envelope: { id: "env_step", status: "approved" },
        explanation: "Allowed",
      }),
      executeApproved: vi.fn().mockResolvedValue({
        success: true,
        summary: "Executed OK",
        externalRefs: { invoiceId: "inv_1" },
        data: { value: 4000 },
      }),
    };
    executor = new DataFlowExecutor({ orchestrator });
  });

  it("executes a single-step plan successfully", async () => {
    const plan = createPlan({
      steps: [
        {
          index: 0,
          cartridgeId: "payments",
          actionType: "payments.invoice.create",
          parameters: { entityId: "cus_1", amount: 500 },
          condition: null,
        },
      ],
    });

    const result = await executor.execute(plan, {
      principalId: "user_1",
      organizationId: "org_1",
    });

    expect(result.overallOutcome).toBe("completed");
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]!.outcome).toBe("executed");
  });

  it("executes multi-step plan with data flow between steps", async () => {
    let proposeCallCount = 0;
    (orchestrator.propose as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      proposeCallCount++;
      return {
        denied: false,
        envelope: { id: `env_${proposeCallCount}`, status: "approved" },
        explanation: "OK",
      };
    });

    let executeCallCount = 0;
    (orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      executeCallCount++;
      if (executeCallCount === 1) {
        return {
          success: true,
          summary: "Treatment logged",
          externalRefs: {},
          data: { value: 4000, treatmentType: "dental_crown" },
        };
      }
      return {
        success: true,
        summary: "Invoice created",
        externalRefs: { invoiceId: "inv_1" },
        data: {},
      };
    });

    const plan = createPlan({
      steps: [
        {
          index: 0,
          cartridgeId: "patient-engagement",
          actionType: "patient-engagement.treatment.log",
          parameters: { patientId: "pat_1", treatmentType: "dental_crown", value: 4000 },
          condition: null,
        },
        {
          index: 1,
          cartridgeId: "payments",
          actionType: "payments.invoice.create",
          parameters: {
            entityId: "cus_1",
            amount: "$prev.result.data.value",
            description: "Treatment: $step[0].result.data.treatmentType",
          },
          condition: "$prev.result.success === true",
        },
      ],
    });

    const result = await executor.execute(plan, {
      principalId: "user_1",
      organizationId: "org_1",
    });

    expect(result.overallOutcome).toBe("completed");
    expect(result.stepResults).toHaveLength(2);

    // Verify the second step received resolved parameters
    const step2Params = (orchestrator.propose as ReturnType<typeof vi.fn>).mock.calls[1]![0].parameters;
    expect(step2Params.amount).toBe(4000);
    expect(step2Params.description).toBe("Treatment: dental_crown");
  });

  it("skips steps with false conditions", async () => {
    (orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      summary: "OK",
      externalRefs: {},
      data: { value: 0 }, // value is 0, condition will fail
    });

    const plan = createPlan({
      steps: [
        {
          index: 0,
          cartridgeId: "patient-engagement",
          actionType: "pe.treatment.log",
          parameters: { patientId: "pat_1" },
          condition: null,
        },
        {
          index: 1,
          cartridgeId: "payments",
          actionType: "payments.invoice.create",
          parameters: { amount: "$prev.result.data.value" },
          condition: "$prev.result.data.value > 1000",
        },
      ],
    });

    const result = await executor.execute(plan, {
      principalId: "user_1",
    });

    expect(result.stepResults[1]!.outcome).toBe("skipped_condition");
    expect(result.overallOutcome).toBe("completed"); // skipped_condition is not failure
  });

  it("sequential strategy stops on first failure", async () => {
    (orchestrator.propose as ReturnType<typeof vi.fn>).mockResolvedValue({
      denied: true,
      envelope: { id: "env_denied", status: "denied" },
      explanation: "Policy denied",
    });

    const plan = createPlan({
      strategy: "sequential",
      steps: [
        {
          index: 0,
          cartridgeId: "payments",
          actionType: "payments.charge.create",
          parameters: {},
          condition: null,
        },
        {
          index: 1,
          cartridgeId: "crm",
          actionType: "crm.activity.log",
          parameters: {},
          condition: null,
        },
      ],
    });

    const result = await executor.execute(plan, { principalId: "user_1" });

    expect(result.stepResults[0]!.outcome).toBe("denied");
    expect(result.stepResults[1]!.outcome).toBe("skipped_prior_failure");
    expect(result.overallOutcome).toBe("failed");
  });

  it("best_effort strategy continues after failure", async () => {
    let callCount = 0;
    (orchestrator.propose as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { denied: true, envelope: { id: "env_1", status: "denied" }, explanation: "Denied" };
      }
      return { denied: false, envelope: { id: "env_2", status: "approved" }, explanation: "OK" };
    });

    const plan = createPlan({
      strategy: "best_effort",
      steps: [
        { index: 0, cartridgeId: "a", actionType: "a.x", parameters: {}, condition: null },
        { index: 1, cartridgeId: "b", actionType: "b.y", parameters: {}, condition: null },
      ],
    });

    const result = await executor.execute(plan, { principalId: "user_1" });

    expect(result.stepResults[0]!.outcome).toBe("denied");
    expect(result.stepResults[1]!.outcome).toBe("executed");
    expect(result.overallOutcome).toBe("partial");
  });

  it("handles pending_approval status", async () => {
    (orchestrator.propose as ReturnType<typeof vi.fn>).mockResolvedValue({
      denied: false,
      envelope: { id: "env_pending", status: "pending_approval" },
      explanation: "Needs approval",
    });

    const plan = createPlan({
      steps: [
        { index: 0, cartridgeId: "a", actionType: "a.x", parameters: {}, condition: null },
        { index: 1, cartridgeId: "b", actionType: "b.y", parameters: {}, condition: null },
      ],
    });

    const result = await executor.execute(plan, { principalId: "user_1" });

    expect(result.stepResults[0]!.outcome).toBe("pending_approval");
    expect(result.stepResults[1]!.outcome).toBe("skipped_prior_failure");
  });

  it("handles execution failure", async () => {
    (orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      summary: "Payment declined",
      externalRefs: {},
    });

    const plan = createPlan({
      steps: [
        { index: 0, cartridgeId: "payments", actionType: "p.x", parameters: {}, condition: null },
      ],
    });

    const result = await executor.execute(plan, { principalId: "user_1" });

    expect(result.stepResults[0]!.outcome).toBe("error");
    expect(result.stepResults[0]!.error).toBe("Payment declined");
    expect(result.overallOutcome).toBe("failed");
  });
});
