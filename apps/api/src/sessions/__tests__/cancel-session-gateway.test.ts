import { describe, it, expect, vi } from "vitest";
import type { AgentRun, AgentSession } from "@switchboard/schemas";
import {
  cancelSessionWithGatewayPropagation,
  resolveOpenClawRunIdForCancel,
} from "../cancel-session-gateway.js";
import { SessionGatewayInflightRegistry } from "../../gateway/session-gateway-inflight.js";
import { SessionManager } from "@switchboard/core/sessions";
import { createSessionTestStores } from "../../test-utils/session-test-stores.js";

describe("resolveOpenClawRunIdForCancel", () => {
  const baseSession = (status: AgentSession["status"]): AgentSession => ({
    id: "550e8400-e29b-41d4-a716-446655440001",
    organizationId: "o",
    roleId: "r",
    principalId: "p",
    status,
    safetyEnvelope: {
      maxToolCalls: 10,
      maxMutations: 2,
      maxDollarsAtRisk: 100,
      sessionTimeoutMs: 60_000,
    },
    allowedToolPack: ["t"],
    governanceProfile: "g",
    toolCallCount: 0,
    mutationCount: 0,
    dollarsAtRisk: 0,
    currentStep: 0,
    toolHistory: [],
    checkpoint: null,
    traceId: "tr",
    startedAt: new Date(),
    completedAt: null,
    errorMessage: null,
  });

  it("prefers the run with null outcome", () => {
    const runs: AgentRun[] = [
      {
        id: "550e8400-e29b-41d4-a716-446655440010",
        sessionId: baseSession("running").id,
        runIndex: 0,
        triggerType: "initial",
        resumeContext: null,
        outcome: "paused_for_approval",
        stepRange: null,
        startedAt: new Date(),
        completedAt: new Date(),
      },
      {
        id: "550e8400-e29b-41d4-a716-446655440011",
        sessionId: baseSession("running").id,
        runIndex: 1,
        triggerType: "resume_approval",
        resumeContext: null,
        outcome: null,
        stepRange: null,
        startedAt: new Date(),
        completedAt: null,
      },
    ];
    expect(resolveOpenClawRunIdForCancel(baseSession("running"), runs)).toBe(
      "550e8400-e29b-41d4-a716-446655440011",
    );
  });

  it("when paused and no active run, uses latest run id", () => {
    const runs: AgentRun[] = [
      {
        id: "550e8400-e29b-41d4-a716-446655440020",
        sessionId: baseSession("paused").id,
        runIndex: 0,
        triggerType: "initial",
        resumeContext: null,
        outcome: "paused_for_approval",
        stepRange: null,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    ];
    expect(resolveOpenClawRunIdForCancel(baseSession("paused"), runs)).toBe(
      "550e8400-e29b-41d4-a716-446655440020",
    );
  });
});

describe("cancelSessionWithGatewayPropagation", () => {
  it("invokes gateway cancel then local cancelSession", async () => {
    const stores = createSessionTestStores();
    const manager = new SessionManager({
      sessions: stores.sessions,
      runs: stores.runs,
      pauses: stores.pauses,
      toolEvents: stores.toolEvents,
      roleOverrides: stores.roleOverrides,
      maxConcurrentSessions: 10,
      getRoleCheckpointValidator: undefined,
    });

    const { session, run } = await manager.createSession({
      organizationId: "org-1",
      roleId: "ad-operator",
      principalId: "u1",
      manifestDefaults: {
        safetyEnvelope: {
          maxToolCalls: 10,
          maxMutations: 2,
          maxDollarsAtRisk: 100,
          sessionTimeoutMs: 60_000,
        },
        toolPack: ["t"],
        governanceProfile: "g",
      },
      maxConcurrentSessionsForRole: 100,
    });

    const gatewayClient = {
      invokeInitial: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn(),
    };

    await cancelSessionWithGatewayPropagation({
      sessionManager: manager,
      gatewayClient: gatewayClient as never,
      sessionTokenSecret: "01234567890123456789012345678901",
      sessionId: session.id,
      inflightRegistry: new SessionGatewayInflightRegistry(),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(gatewayClient.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        runId: run.id,
        traceId: session.traceId,
      }),
    );
    expect(gatewayClient.cancel.mock.calls[0]![0].sessionToken).toMatch(/^ey/);
    const after = await manager.getSession(session.id);
    expect(after!.status).toBe("cancelled");
  });

  it("calls inflightRegistry.abortInvocation before gateway cancel", async () => {
    const stores = createSessionTestStores();
    const manager = new SessionManager({
      sessions: stores.sessions,
      runs: stores.runs,
      pauses: stores.pauses,
      toolEvents: stores.toolEvents,
      roleOverrides: stores.roleOverrides,
      maxConcurrentSessions: 10,
      getRoleCheckpointValidator: undefined,
    });

    const { session } = await manager.createSession({
      organizationId: "org-1",
      roleId: "ad-operator",
      principalId: "u1",
      manifestDefaults: {
        safetyEnvelope: {
          maxToolCalls: 10,
          maxMutations: 2,
          maxDollarsAtRisk: 100,
          sessionTimeoutMs: 60_000,
        },
        toolPack: ["t"],
        governanceProfile: "g",
      },
      maxConcurrentSessionsForRole: 100,
    });

    const inflightRegistry = new SessionGatewayInflightRegistry();
    const abortSpy = vi.spyOn(inflightRegistry, "abortInvocation");
    const gatewayClient = {
      invokeInitial: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn(),
    };

    await cancelSessionWithGatewayPropagation({
      sessionManager: manager,
      gatewayClient: gatewayClient as never,
      sessionTokenSecret: "01234567890123456789012345678901",
      sessionId: session.id,
      inflightRegistry,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(abortSpy).toHaveBeenCalledWith(session.id);
    expect(gatewayClient.cancel).toHaveBeenCalled();
  });
});
