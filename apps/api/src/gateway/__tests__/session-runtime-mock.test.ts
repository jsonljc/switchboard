import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  SessionManager,
  buildResumePayload,
  applyGatewayOutcomeToSession,
  type ManifestDefaults,
} from "@switchboard/core/sessions";
import { createSessionTestStores } from "../../test-utils/session-test-stores.js";
import { issueSessionToken } from "../../auth/session-token.js";
import {
  MockGatewayClient,
  mockComplete,
  mockFail,
  mockPause,
  mockThrowInvalidJson,
  mockThrowTimeout,
  sampleToolCall,
} from "../mock-gateway-client.js";
import type { LoadedManifest } from "../../bootstrap/role-manifests.js";

const defaultManifest: ManifestDefaults = {
  safetyEnvelope: {
    maxToolCalls: 200,
    maxMutations: 50,
    maxDollarsAtRisk: 10_000,
    sessionTimeoutMs: 30 * 60 * 1000,
  },
  toolPack: ["tool_a", "tool_b"],
  governanceProfile: "guarded",
};

const secret = "test-secret-test-secret-test-secret-32";

function createLoadedManifest(): LoadedManifest {
  return {
    manifest: {
      id: "test-role",
      name: "Test",
      description: "t",
      version: "1",
      toolPack: defaultManifest.toolPack,
      governanceProfile: defaultManifest.governanceProfile,
      safetyEnvelope: defaultManifest.safetyEnvelope,
      instructionPath: "x",
      checkpointSchemaPath: "y",
      maxConcurrentSessions: 100,
    },
    instruction: "Do the thing.",
    checkpointSchema: null,
    manifestDir: ".",
  };
}

describe("mock gateway session runtime", () => {
  let stores: ReturnType<typeof createSessionTestStores>;
  let manager: SessionManager;
  let gateway: MockGatewayClient;
  let loaded: LoadedManifest;

  beforeEach(() => {
    stores = createSessionTestStores();
    gateway = new MockGatewayClient();
    loaded = createLoadedManifest();
    manager = new SessionManager({
      ...stores,
      maxConcurrentSessions: 10,
    });
  });

  async function invokeLikeWorker(sessionId: string, runId: string, resumeToken: string) {
    const session = (await manager.getSession(sessionId))!;
    const elapsed = Date.now() - session.startedAt.getTime();
    const sessionToken = await issueSessionToken({
      sessionId: session.id,
      organizationId: session.organizationId,
      principalId: session.principalId,
      roleId: session.roleId,
      secret,
      expiresInMs: Math.max(0, session.safetyEnvelope.sessionTimeoutMs - elapsed),
    });
    const idempotencyKey = `${runId}:${resumeToken || "initial"}`;

    if (resumeToken) {
      const pause = (await manager.getPauseByResumeToken(sessionId, resumeToken))!;
      const toolHistory = await manager.getToolHistory(sessionId);
      const resumePayload = buildResumePayload({
        session,
        pause,
        toolHistory,
        runId,
        instruction: loaded.instruction,
      });
      const response = await gateway.resume({
        kind: "resume",
        sessionId,
        runId,
        roleId: session.roleId,
        sessionToken,
        traceId: session.traceId,
        idempotencyKey,
        resumePayload,
      });
      await applyGatewayOutcomeToSession({
        sessionManager: manager,
        sessionId,
        runId,
        response,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
    } else {
      const response = await gateway.invokeInitial({
        kind: "initial",
        sessionId,
        runId,
        roleId: session.roleId,
        sessionToken,
        traceId: session.traceId,
        idempotencyKey,
        instruction: loaded.instruction,
        allowedToolPack: session.allowedToolPack,
        governanceProfile: session.governanceProfile,
        safetyLimits: session.safetyEnvelope,
      });
      await applyGatewayOutcomeToSession({
        sessionManager: manager,
        sessionId,
        runId,
        response,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
    }
  }

  it("full flow: create → invoke → pause → approve → resume → complete", async () => {
    const approvalId = randomUUID();
    gateway.enqueue(
      mockPause({
        checkpoint: {
          agentState: { step: 1 },
          pendingApprovalId: approvalId,
        },
        toolCalls: [sampleToolCall({ idempotencyKey: "t1" })],
      }),
    );
    gateway.enqueue(mockComplete([sampleToolCall({ idempotencyKey: "t2", toolName: "tool_b" })]));

    const { session, run } = await manager.createSession({
      organizationId: "org-1",
      roleId: "test-role",
      principalId: "p1",
      manifestDefaults: defaultManifest,
      maxConcurrentSessionsForRole: 100,
    });

    await invokeLikeWorker(session.id, run.id, "");

    let s = await manager.getSession(session.id);
    expect(s!.status).toBe("paused");
    expect(s!.toolCallCount).toBe(1);

    const resume = await manager.resumeAfterApproval(approvalId, {
      action: "approve",
      respondedBy: "owner",
    });
    expect(resume).not.toBeNull();

    await invokeLikeWorker(session.id, resume!.run.id, resume!.resumeToken);

    s = await manager.getSession(session.id);
    expect(s!.status).toBe("completed");
    expect(s!.toolCallCount).toBe(2);
  });

  it("failure path via mockFail", async () => {
    gateway.enqueue(mockFail("E_TEST", "boom"));

    const { session, run } = await manager.createSession({
      organizationId: "org-1",
      roleId: "test-role",
      principalId: "p1",
      manifestDefaults: defaultManifest,
      maxConcurrentSessionsForRole: 100,
    });

    await invokeLikeWorker(session.id, run.id, "");

    const s = await manager.getSession(session.id);
    expect(s!.status).toBe("failed");
    expect(s!.errorCode).toBe("E_TEST");
    expect(s!.errorMessage).toBe("boom");
  });

  it("invalid checkpoint on pause fails session via apply outcome", async () => {
    manager = new SessionManager({
      ...stores,
      maxConcurrentSessions: 10,
      getRoleCheckpointValidator: () => () => ({
        valid: false,
        errors: ["role says no"],
      }),
    });

    const approvalId = randomUUID();
    gateway.enqueue(
      mockPause({
        checkpoint: {
          agentState: {},
          pendingApprovalId: approvalId,
        },
      }),
    );

    const { session, run } = await manager.createSession({
      organizationId: "org-1",
      roleId: "test-role",
      principalId: "p1",
      manifestDefaults: defaultManifest,
      maxConcurrentSessionsForRole: 100,
    });

    await invokeLikeWorker(session.id, run.id, "");

    const s = await manager.getSession(session.id);
    expect(s!.status).toBe("failed");
    expect(s!.errorCode).toBe("INVALID_CHECKPOINT");
  });

  it("duplicate tool rows with same gateway idempotency key do not double-count counters", async () => {
    const tc = sampleToolCall({ idempotencyKey: "replay-key", toolName: "tool_a" });
    gateway.enqueue(mockComplete([tc, { ...tc, result: { echoed: true } }]));

    const { session, run } = await manager.createSession({
      organizationId: "org-1",
      roleId: "test-role",
      principalId: "p1",
      manifestDefaults: defaultManifest,
      maxConcurrentSessionsForRole: 100,
    });

    await invokeLikeWorker(session.id, run.id, "");

    const s = await manager.getSession(session.id);
    expect(s!.status).toBe("completed");
    expect(s!.toolCallCount).toBe(1);
  });

  it("duplicate resume throws ConcurrentResumeError", async () => {
    const approvalId = randomUUID();
    gateway.enqueue(
      mockPause({
        checkpoint: { agentState: {}, pendingApprovalId: approvalId },
      }),
    );
    gateway.enqueue(mockComplete());

    const { session, run } = await manager.createSession({
      organizationId: "org-1",
      roleId: "test-role",
      principalId: "p1",
      manifestDefaults: defaultManifest,
      maxConcurrentSessionsForRole: 100,
    });

    await invokeLikeWorker(session.id, run.id, "");

    await manager.resumeAfterApproval(approvalId, { action: "approve", respondedBy: "x" });

    await expect(
      manager.resumeAfterApproval(approvalId, { action: "approve", respondedBy: "x" }),
    ).rejects.toThrow(/Concurrent resume/);
  });
});

describe("MockGatewayClient errors", () => {
  it("timeout and invalid response propagate", async () => {
    const g = new MockGatewayClient();
    g.enqueue(mockThrowTimeout());
    await expect(
      g.invokeInitial({
        kind: "initial",
        sessionId: randomUUID(),
        runId: randomUUID(),
        roleId: "r",
        sessionToken: "t",
        traceId: "tr",
        idempotencyKey: "k",
        instruction: "i",
        allowedToolPack: [],
        governanceProfile: "g",
        safetyLimits: defaultManifest.safetyEnvelope,
      }),
    ).rejects.toThrow(/timeout/i);

    g.clear();
    g.enqueue(mockThrowInvalidJson());
    await expect(
      g.invokeInitial({
        kind: "initial",
        sessionId: randomUUID(),
        runId: randomUUID(),
        roleId: "r",
        sessionToken: "t",
        traceId: "tr",
        idempotencyKey: "k",
        instruction: "i",
        allowedToolPack: [],
        governanceProfile: "g",
        safetyLimits: defaultManifest.safetyEnvelope,
      }),
    ).rejects.toThrow(/malformed/i);
  });
});
