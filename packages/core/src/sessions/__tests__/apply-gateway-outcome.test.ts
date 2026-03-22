import { describe, it, expect, beforeEach } from "vitest";
import { applyGatewayOutcomeToSession } from "../apply-gateway-outcome.js";
import { SessionManager } from "../session-manager.js";
import { createTestStores } from "./test-stores.js";
import type { AgentSession } from "@switchboard/schemas";

describe("applyGatewayOutcomeToSession", () => {
  const stores = createTestStores();
  let manager: SessionManager;

  beforeEach(() => {
    stores.sessions.items.clear();
    stores.runs.items.clear();
    stores.pauses.items.clear();
    stores.toolEvents.items.length = 0;
    manager = new SessionManager({
      sessions: stores.sessions,
      runs: stores.runs,
      pauses: stores.pauses,
      toolEvents: stores.toolEvents,
      roleOverrides: stores.roleOverrides,
      maxConcurrentSessions: 10,
      getRoleCheckpointValidator: undefined,
    });
  });

  it("fails session when gateway reports a tool outside allowedToolPack", async () => {
    const session: AgentSession = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      organizationId: "org-1",
      roleId: "ad-operator",
      principalId: "p1",
      status: "running",
      safetyEnvelope: {
        maxToolCalls: 10,
        maxMutations: 5,
        maxDollarsAtRisk: 1000,
        sessionTimeoutMs: 60_000,
      },
      allowedToolPack: ["allowed_only"],
      governanceProfile: "guarded",
      toolCallCount: 0,
      mutationCount: 0,
      dollarsAtRisk: 0,
      currentStep: 0,
      toolHistory: [],
      checkpoint: null,
      traceId: "trace-x",
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
    };
    await stores.sessions.create(session);
    const runId = "550e8400-e29b-41d4-a716-446655440002";
    await stores.runs.save({
      id: runId,
      sessionId: session.id,
      runIndex: 0,
      triggerType: "initial",
      resumeContext: null,
      outcome: null,
      stepRange: null,
      startedAt: new Date(),
      completedAt: null,
    });

    const logger = { info: () => {}, warn: () => {}, error: () => {} };

    await applyGatewayOutcomeToSession({
      sessionManager: manager,
      sessionId: session.id,
      runId,
      response: {
        status: "completed",
        toolCalls: [
          {
            idempotencyKey: "gw-1",
            toolName: "evil_tool",
            parameters: {},
            result: null,
            isMutation: false,
            dollarsAtRisk: 0,
            durationMs: null,
            envelopeId: null,
          },
        ],
        result: {},
      },
      logger,
    });

    const after = await manager.getSession(session.id);
    expect(after!.status).toBe("failed");
    expect(after!.errorCode).toBe("RUNTIME_TOOL_NOT_ALLOWED");
    expect(stores.toolEvents.items).toHaveLength(0);
  });

  it("records allowed tools then completes", async () => {
    const { session, run } = await manager.createSession({
      organizationId: "org-1",
      roleId: "ad-operator",
      principalId: "user-1",
      manifestDefaults: {
        safetyEnvelope: {
          maxToolCalls: 10,
          maxMutations: 5,
          maxDollarsAtRisk: 1000,
          sessionTimeoutMs: 60_000,
        },
        toolPack: ["ok_tool"],
        governanceProfile: "guarded",
      },
      maxConcurrentSessionsForRole: 100,
    });
    const runId = run.id;

    await applyGatewayOutcomeToSession({
      sessionManager: manager,
      sessionId: session.id,
      runId,
      response: {
        status: "completed",
        toolCalls: [
          {
            idempotencyKey: "gw-1",
            toolName: "ok_tool",
            parameters: {},
            result: {},
            isMutation: false,
            dollarsAtRisk: 0,
            durationMs: 10,
            envelopeId: null,
          },
        ],
        result: {},
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const after = await manager.getSession(session.id);
    expect(after!.status).toBe("completed");
    expect(stores.toolEvents.items).toHaveLength(1);
  });
});
