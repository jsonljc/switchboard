import { describe, it, expect, beforeEach } from "vitest";
import {
  SessionManager,
  SafetyEnvelopeExceededError,
  ConcurrentResumeError,
} from "../session-manager.js";
import { SessionTransitionError } from "../state-machine.js";
import { createTestStores } from "./test-stores.js";
import type { ManifestDefaults } from "../role-config-merger.js";
import type { TestStores } from "./test-stores.js";

const defaultManifest: ManifestDefaults = {
  safetyEnvelope: {
    maxToolCalls: 200,
    maxMutations: 50,
    maxDollarsAtRisk: 10_000,
    sessionTimeoutMs: 30 * 60 * 1000,
  },
  toolPack: ["digital-ads", "crm"],
  governanceProfile: "guarded",
};

describe("SessionManager", () => {
  let stores: TestStores;
  let manager: SessionManager;

  beforeEach(() => {
    stores = createTestStores();
    manager = new SessionManager({
      ...stores,
      maxConcurrentSessions: 5,
    });
  });

  // -----------------------------------------------------------------------
  // createSession
  // -----------------------------------------------------------------------

  describe("createSession", () => {
    it("creates session with status running and initial run", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      expect(session.status).toBe("running");
      expect(session.toolCallCount).toBe(0);
      expect(session.mutationCount).toBe(0);
      expect(session.dollarsAtRisk).toBe(0);
      expect(session.currentStep).toBe(0);
      expect(session.completedAt).toBeNull();

      expect(run.runIndex).toBe(0);
      expect(run.triggerType).toBe("initial");
      expect(run.sessionId).toBe(session.id);
    });

    it("rejects when concurrent session limit exceeded", async () => {
      // Create 5 sessions to hit the limit
      for (let i = 0; i < 5; i++) {
        await manager.createSession({
          organizationId: "org-1",
          roleId: "ad-operator",
          principalId: `user-${i}`,
          manifestDefaults: defaultManifest,
        });
      }

      await expect(
        manager.createSession({
          organizationId: "org-1",
          roleId: "ad-operator",
          principalId: "user-6",
          manifestDefaults: defaultManifest,
        }),
      ).rejects.toThrow("Concurrent session limit");
    });
  });

  // -----------------------------------------------------------------------
  // recordToolCall
  // -----------------------------------------------------------------------

  describe("recordToolCall", () => {
    it("records tool event and updates session counters", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      const event = await manager.recordToolCall(session.id, {
        runId: run.id,
        toolName: "get_metrics",
        parameters: { campaign: "c1" },
        result: { impressions: 1000 },
        isMutation: false,
        dollarsAtRisk: 0,
        durationMs: 100,
        envelopeId: null,
      });

      expect(event.toolName).toBe("get_metrics");
      expect(event.stepIndex).toBe(0);

      const updated = await manager.getSession(session.id);
      expect(updated!.toolCallCount).toBe(1);
      expect(updated!.currentStep).toBe(1);
      expect(updated!.mutationCount).toBe(0);
    });

    it("increments mutation count for side-effect tools", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.recordToolCall(session.id, {
        runId: run.id,
        toolName: "update_budget",
        parameters: { budget: 500 },
        result: { success: true },
        isMutation: true,
        dollarsAtRisk: 500,
        durationMs: 200,
        envelopeId: null,
      });

      const updated = await manager.getSession(session.id);
      expect(updated!.mutationCount).toBe(1);
      expect(updated!.dollarsAtRisk).toBe(500);
    });

    it("rejects when safety envelope exceeded", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: {
          ...defaultManifest,
          safetyEnvelope: { ...defaultManifest.safetyEnvelope, maxToolCalls: 1 },
        },
      });

      // First call succeeds
      await manager.recordToolCall(session.id, {
        runId: run.id,
        toolName: "get_metrics",
        parameters: {},
        result: {},
        isMutation: false,
        dollarsAtRisk: 0,
        durationMs: 50,
        envelopeId: null,
      });

      // Second call exceeds limit
      await expect(
        manager.recordToolCall(session.id, {
          runId: run.id,
          toolName: "get_metrics",
          parameters: {},
          result: {},
          isMutation: false,
          dollarsAtRisk: 0,
          durationMs: 50,
          envelopeId: null,
        }),
      ).rejects.toThrow(SafetyEnvelopeExceededError);
    });
  });

  // -----------------------------------------------------------------------
  // pauseSession
  // -----------------------------------------------------------------------

  describe("pauseSession", () => {
    it("transitions to paused and creates pause record", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      const pause = await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: { step: 3 } },
      });

      expect(pause.resumeStatus).toBe("pending");
      expect(pause.pauseIndex).toBe(0);
      expect(pause.approvalId).toBe("appr-1");

      const updated = await manager.getSession(session.id);
      expect(updated!.status).toBe("paused");

      const updatedRun = await stores.runs.getById(run.id);
      expect(updatedRun!.outcome).toBe("paused_for_approval");
    });

    it("rejects pause from terminal state", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.completeSession(session.id, { runId: run.id });

      await expect(
        manager.pauseSession(session.id, {
          runId: run.id,
          approvalId: "appr-1",
          checkpoint: { agentState: {} },
        }),
      ).rejects.toThrow(SessionTransitionError);
    });
  });

  // -----------------------------------------------------------------------
  // resumeAfterApproval
  // -----------------------------------------------------------------------

  describe("resumeAfterApproval", () => {
    it("marks resume and transitions paused → running", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: { step: 5 } },
      });

      const result = await manager.resumeAfterApproval("appr-1", {
        action: "approve",
        respondedBy: "owner-1",
      });

      expect(result).not.toBeNull();
      expect(result!.session.status).toBe("running");
      expect(result!.run.triggerType).toBe("resume_approval");
      expect(result!.run.runIndex).toBe(1);
    });

    it("returns null when no linked pause found", async () => {
      const result = await manager.resumeAfterApproval("nonexistent-appr", {
        action: "approve",
      });
      expect(result).toBeNull();
    });

    it("rejects on concurrent resume (CAS fails)", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: {} },
      });

      // First resume succeeds
      await manager.resumeAfterApproval("appr-1", { action: "approve" });

      // Second resume should fail
      await expect(manager.resumeAfterApproval("appr-1", { action: "approve" })).rejects.toThrow(
        ConcurrentResumeError,
      );
    });
  });

  // -----------------------------------------------------------------------
  // completeSession
  // -----------------------------------------------------------------------

  describe("completeSession", () => {
    it("transitions to completed with timestamp", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.completeSession(session.id, { runId: run.id });

      const updated = await manager.getSession(session.id);
      expect(updated!.status).toBe("completed");
      expect(updated!.completedAt).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // failSession
  // -----------------------------------------------------------------------

  describe("failSession", () => {
    it("transitions to failed", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.failSession(session.id, { runId: run.id, error: "timeout" });

      const updated = await manager.getSession(session.id);
      expect(updated!.status).toBe("failed");
    });
  });

  // -----------------------------------------------------------------------
  // cancelSession
  // -----------------------------------------------------------------------

  describe("cancelSession", () => {
    it("cancels from running state", async () => {
      const { session } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.cancelSession(session.id);

      const updated = await manager.getSession(session.id);
      expect(updated!.status).toBe("cancelled");
    });

    it("cancels from paused state", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: {} },
      });

      await manager.cancelSession(session.id);

      const updated = await manager.getSession(session.id);
      expect(updated!.status).toBe("cancelled");
    });

    it("rejects from terminal state", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      await manager.completeSession(session.id, { runId: run.id });

      await expect(manager.cancelSession(session.id)).rejects.toThrow(SessionTransitionError);
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle integration
  // -----------------------------------------------------------------------

  describe("lifecycle integration", () => {
    it("full flow: create → tool calls → pause → resume → more calls → complete", async () => {
      const { session, run: run1 } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "user-1",
        manifestDefaults: defaultManifest,
      });

      // Read-only tool call
      await manager.recordToolCall(session.id, {
        runId: run1.id,
        toolName: "get_metrics",
        parameters: {},
        result: { impressions: 1000 },
        isMutation: false,
        dollarsAtRisk: 0,
        durationMs: 100,
        envelopeId: null,
      });

      // Mutation tool call
      await manager.recordToolCall(session.id, {
        runId: run1.id,
        toolName: "update_budget",
        parameters: { budget: 500 },
        result: { success: true },
        isMutation: true,
        dollarsAtRisk: 500,
        durationMs: 200,
        envelopeId: null,
      });

      // Pause for approval
      await manager.pauseSession(session.id, {
        runId: run1.id,
        approvalId: "appr-1",
        checkpoint: { agentState: { step: 2 } },
      });

      // Resume after approval
      const resumeResult = await manager.resumeAfterApproval("appr-1", {
        action: "approve",
        respondedBy: "owner-1",
      });
      expect(resumeResult).not.toBeNull();
      const run2 = resumeResult!.run;

      // More tool calls on new run
      await manager.recordToolCall(session.id, {
        runId: run2.id,
        toolName: "apply_optimization",
        parameters: {},
        result: { applied: true },
        isMutation: true,
        dollarsAtRisk: 200,
        durationMs: 300,
        envelopeId: null,
      });

      // Complete
      await manager.completeSession(session.id, { runId: run2.id });

      // Verify final state
      const finalSession = await manager.getSession(session.id);
      expect(finalSession!.status).toBe("completed");
      expect(finalSession!.toolCallCount).toBe(3);
      expect(finalSession!.mutationCount).toBe(2);
      expect(finalSession!.dollarsAtRisk).toBe(700);
      expect(finalSession!.currentStep).toBe(3);

      // Verify runs
      const runs = await stores.runs.listBySession(session.id);
      expect(runs).toHaveLength(2);
      expect(runs[0]!.triggerType).toBe("initial");
      expect(runs[1]!.triggerType).toBe("resume_approval");

      // Verify tool history
      const toolHistory = await manager.getToolHistory(session.id);
      expect(toolHistory).toHaveLength(3);
    });
  });
});
