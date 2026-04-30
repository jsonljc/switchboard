import { describe, it, expect } from "vitest";
import type {
  DeploymentLifecycleActionKind,
  DeploymentLifecycleStore,
  HaltAllInput,
  ResumeInput,
  SuspendAllInput,
} from "../deployment-lifecycle-store.js";

describe("DeploymentLifecycleStore types", () => {
  it("exports the three action kinds", () => {
    const kinds: DeploymentLifecycleActionKind[] = [
      "agent_deployment.halt",
      "agent_deployment.resume",
      "agent_deployment.suspend",
    ];
    expect(kinds).toHaveLength(3);
  });

  it("HaltAllInput has organizationId, operator, reason", () => {
    const input: HaltAllInput = {
      organizationId: "org_1",
      operator: { type: "user", id: "u_1" },
      reason: null,
    };
    expect(input.organizationId).toBe("org_1");
  });

  it("ResumeInput requires skillSlug", () => {
    const input: ResumeInput = {
      organizationId: "org_1",
      skillSlug: "alex",
      operator: { type: "user", id: "u_1" },
    };
    expect(input.skillSlug).toBe("alex");
  });

  it("SuspendAllInput accepts service actor", () => {
    const input: SuspendAllInput = {
      organizationId: "org_1",
      operator: { type: "service", id: "stripe-webhook" },
      reason: "subscription_canceled",
    };
    expect(input.operator.type).toBe("service");
  });

  it("DeploymentLifecycleStore declares haltAll, resume, suspendAll", () => {
    const store: DeploymentLifecycleStore = {
      haltAll: async () => ({ workTraceId: "t", affectedDeploymentIds: [], count: 0 }),
      resume: async () => ({ workTraceId: "t", affectedDeploymentIds: [], count: 0 }),
      suspendAll: async () => ({ workTraceId: "t", affectedDeploymentIds: [], count: 0 }),
    };
    expect(typeof store.haltAll).toBe("function");
  });
});
