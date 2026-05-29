import { describe, it, expect, vi } from "vitest";
import { createDelegateToolFactory } from "./delegate.js";
import type { ChildWorkSubmitter, DelegationTarget } from "../delegation-port.js";
import type { SkillRequestContext } from "../types.js";

const target: DelegationTarget = {
  operation: "creative_concept",
  intent: "creative.concept.draft",
  description: "draft a creative concept",
  inputSchema: { type: "object", properties: {}, required: [] },
  mapInput: (input) => ({ brief: input }),
};

const ctx = (over: Partial<SkillRequestContext> = {}): SkillRequestContext => ({
  sessionId: "s1",
  orgId: "org-1",
  deploymentId: "dep-alex",
  workUnitId: "wu-parent",
  delegationDepth: 0,
  ...over,
});

const okSubmitter = (): ChildWorkSubmitter => ({
  submitChildWork: vi
    .fn()
    .mockResolvedValue({ ok: true, outcome: "completed", childWorkUnitId: "wu-child" }),
});

describe("delegate tool", () => {
  it("submits a governed child with agent actor, parent lineage, deterministic key, incremented depth", async () => {
    const submitter = okSubmitter();
    const tool = createDelegateToolFactory({
      submitter,
      targets: [target],
      maxDepth: 1,
      hashParameters: () => "HASH",
    })(ctx());
    const res = await tool.operations["creative_concept"]!.execute({ productDescription: "botox" });

    expect(res.status).toBe("success");
    expect(res.data).toMatchObject({ childWorkUnitId: "wu-child", outcome: "completed" });
    expect(submitter.submitChildWork).toHaveBeenCalledWith({
      organizationId: "org-1",
      actor: { id: "dep-alex", type: "agent" },
      intent: "creative.concept.draft",
      parameters: { brief: { productDescription: "botox" }, __delegationDepth: 1 },
      parentWorkUnitId: "wu-parent",
      idempotencyKey: "delegate:wu-parent:creative.concept.draft:HASH",
    });
  });

  it("exposes only configured operations (allowlist by construction)", () => {
    const tool = createDelegateToolFactory({ submitter: okSubmitter(), targets: [target] })(ctx());
    expect(Object.keys(tool.operations)).toEqual(["creative_concept"]);
  });

  it("refuses when delegationDepth >= maxDepth and never calls the submitter", async () => {
    const submitter = okSubmitter();
    const tool = createDelegateToolFactory({ submitter, targets: [target], maxDepth: 1 })(
      ctx({ delegationDepth: 1 }),
    );
    const res = await tool.operations["creative_concept"]!.execute({});
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("DELEGATION_DEPTH_EXCEEDED");
    expect(submitter.submitChildWork).not.toHaveBeenCalled();
  });

  it("refuses when there is no parent workUnitId to anchor lineage", async () => {
    const submitter = okSubmitter();
    const tool = createDelegateToolFactory({ submitter, targets: [target] })(
      ctx({ workUnitId: undefined }),
    );
    const res = await tool.operations["creative_concept"]!.execute({});
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("NO_PARENT_WORK_UNIT");
    expect(submitter.submitChildWork).not.toHaveBeenCalled();
  });

  it("surfaces pending_approval without claiming success", async () => {
    const submitter: ChildWorkSubmitter = {
      submitChildWork: vi.fn().mockResolvedValue({ ok: true, outcome: "pending_approval" }),
    };
    const tool = createDelegateToolFactory({ submitter, targets: [target] })(ctx());
    const res = await tool.operations["creative_concept"]!.execute({});
    expect(res.status).toBe("pending_approval");
  });

  it("surfaces a failed child submit as an error", async () => {
    const submitter: ChildWorkSubmitter = {
      submitChildWork: vi.fn().mockResolvedValue({ ok: false, error: "trigger_not_allowed" }),
    };
    const tool = createDelegateToolFactory({ submitter, targets: [target] })(ctx());
    const res = await tool.operations["creative_concept"]!.execute({});
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("DELEGATION_FAILED");
  });

  it("declares effectCategory propose and is idempotent", () => {
    const tool = createDelegateToolFactory({ submitter: okSubmitter(), targets: [target] })(ctx());
    const op = tool.operations["creative_concept"]!;
    expect(op.effectCategory).toBe("propose");
    expect(op.idempotent).toBe(true);
  });
});
