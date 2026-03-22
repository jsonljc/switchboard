import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  AgentRun,
  AgentPause,
  AgentCheckpoint,
  ToolEvent,
} from "@switchboard/schemas";
import type {
  SessionStore,
  RunStore,
  PauseStore,
  ToolEventStore,
  RoleOverrideStore,
} from "./store-interfaces.js";
import { canTransition, SessionTransitionError } from "./state-machine.js";
import { validateCheckpoint } from "./checkpoint-validator.js";
import type { RoleCheckpointValidator } from "./checkpoint-validator.js";
import type { ManifestDefaults } from "./role-config-merger.js";
import { mergeRoleConfig } from "./role-config-merger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionManagerDeps {
  sessions: SessionStore;
  runs: RunStore;
  pauses: PauseStore;
  toolEvents: ToolEventStore;
  roleOverrides: RoleOverrideStore;
  /** Global ceiling (e.g. env); combined with per-role manifest cap at create time */
  maxConcurrentSessions: number;
  /** Optional role-specific checkpoint extension (JSON Schema / Ajv), keyed by roleId */
  getRoleCheckpointValidator?: (roleId: string) => RoleCheckpointValidator | undefined;
}

export interface CreateSessionInput {
  organizationId: string;
  roleId: string;
  principalId: string;
  manifestDefaults: ManifestDefaults;
  safetyEnvelopeOverride?: Partial<AgentSession["safetyEnvelope"]>;
  /** From role manifest maxConcurrentSessions — capped by deps.maxConcurrentSessions */
  maxConcurrentSessionsForRole: number;
}

export interface RecordToolCallInput {
  runId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown> | null;
  isMutation: boolean;
  dollarsAtRisk: number;
  durationMs: number | null;
  envelopeId: string | null;
}

export interface PauseSessionInput {
  runId: string;
  approvalId: string;
  checkpoint: AgentCheckpoint;
}

export interface ResumeResult {
  session: AgentSession;
  run: AgentRun;
  resumeToken: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SafetyEnvelopeExceededError extends Error {
  constructor(
    public readonly field: string,
    public readonly current: number,
    public readonly max: number,
  ) {
    super(`Safety envelope exceeded: ${field} (${current}/${max})`);
    this.name = "SafetyEnvelopeExceededError";
  }
}

export class ConcurrentResumeError extends Error {
  constructor(pauseId: string) {
    super(`Concurrent resume detected for pause ${pauseId}`);
    this.name = "ConcurrentResumeError";
  }
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private readonly deps: SessionManagerDeps;

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // createSession
  // -------------------------------------------------------------------------

  async createSession(
    input: CreateSessionInput,
  ): Promise<{ session: AgentSession; run: AgentRun }> {
    const orgOverride = await this.deps.roleOverrides.getByOrgAndRole(
      input.organizationId,
      input.roleId,
    );

    const merged = mergeRoleConfig({
      manifestDefaults: input.manifestDefaults,
      orgOverride,
      requestOverride: input.safetyEnvelopeOverride,
    });

    const effectiveConcurrentCap = Math.min(
      this.deps.maxConcurrentSessions,
      input.maxConcurrentSessionsForRole,
    );

    const sessionId = randomUUID();
    const runId = randomUUID();
    const now = new Date();

    const session: AgentSession = {
      id: sessionId,
      organizationId: input.organizationId,
      roleId: input.roleId,
      principalId: input.principalId,
      status: "running",
      safetyEnvelope: merged.safetyEnvelope,
      toolCallCount: 0,
      mutationCount: 0,
      dollarsAtRisk: 0,
      currentStep: 0,
      toolHistory: [],
      checkpoint: null,
      traceId: randomUUID(),
      startedAt: now,
      completedAt: null,
    };

    const run: AgentRun = {
      id: runId,
      sessionId,
      runIndex: 0,
      triggerType: "initial",
      resumeContext: null,
      outcome: null,
      stepRange: null,
      startedAt: now,
      completedAt: null,
    };

    // Atomic check-and-insert: prevents TOCTOU race on concurrent session creation
    const created = await this.deps.sessions.createIfUnderLimit(session, effectiveConcurrentCap);
    if (!created) {
      throw new Error(
        `Concurrent session limit (${effectiveConcurrentCap}) exceeded for org ${input.organizationId} role ${input.roleId}`,
      );
    }

    await this.deps.runs.save(run);

    return { session, run };
  }

  // -------------------------------------------------------------------------
  // recordToolCall
  // -------------------------------------------------------------------------

  async recordToolCall(sessionId: string, input: RecordToolCallInput): Promise<ToolEvent> {
    const session = await this.requireSession(sessionId);
    this.assertNotTerminal(session);

    // Enforce safety envelope BEFORE recording
    const env = session.safetyEnvelope;
    if (session.toolCallCount + 1 > env.maxToolCalls) {
      throw new SafetyEnvelopeExceededError(
        "toolCalls",
        session.toolCallCount + 1,
        env.maxToolCalls,
      );
    }
    if (input.isMutation && session.mutationCount + 1 > env.maxMutations) {
      throw new SafetyEnvelopeExceededError(
        "mutations",
        session.mutationCount + 1,
        env.maxMutations,
      );
    }
    if (session.dollarsAtRisk + input.dollarsAtRisk > env.maxDollarsAtRisk) {
      throw new SafetyEnvelopeExceededError(
        "dollarsAtRisk",
        session.dollarsAtRisk + input.dollarsAtRisk,
        env.maxDollarsAtRisk,
      );
    }

    const event: ToolEvent = {
      id: randomUUID(),
      sessionId,
      runId: input.runId,
      stepIndex: session.currentStep,
      toolName: input.toolName,
      parameters: input.parameters,
      result: input.result,
      isMutation: input.isMutation,
      dollarsAtRisk: input.dollarsAtRisk,
      durationMs: input.durationMs,
      envelopeId: input.envelopeId,
      timestamp: new Date(),
    };

    await this.deps.toolEvents.record(event);
    await this.deps.sessions.update(sessionId, {
      toolCallCount: session.toolCallCount + 1,
      mutationCount: session.mutationCount + (input.isMutation ? 1 : 0),
      dollarsAtRisk: session.dollarsAtRisk + input.dollarsAtRisk,
      currentStep: session.currentStep + 1,
    });

    return event;
  }

  // -------------------------------------------------------------------------
  // pauseSession
  // -------------------------------------------------------------------------

  async pauseSession(sessionId: string, input: PauseSessionInput): Promise<AgentPause> {
    const session = await this.requireSession(sessionId);
    this.assertTransition(session.status, "paused");

    const validation = validateCheckpoint(input.checkpoint);
    if (!validation.valid) {
      throw new Error(`Invalid checkpoint: ${validation.errors.join(", ")}`);
    }

    const roleValidate = this.deps.getRoleCheckpointValidator?.(session.roleId);
    if (roleValidate) {
      const roleResult = roleValidate(input.checkpoint);
      if (!roleResult.valid) {
        throw new Error(`Invalid checkpoint: ${roleResult.errors.join(", ")}`);
      }
    }

    const existingPauses = await this.deps.pauses.listBySession(sessionId);
    const pauseIndex = existingPauses.length;

    const pause: AgentPause = {
      id: randomUUID(),
      sessionId,
      runId: input.runId,
      pauseIndex,
      approvalId: input.approvalId,
      resumeStatus: "pending",
      resumeToken: randomUUID(),
      checkpoint: input.checkpoint,
      approvalOutcome: null,
      createdAt: new Date(),
      resumedAt: null,
    };

    await this.deps.pauses.save(pause);
    await this.deps.sessions.update(sessionId, {
      status: "paused",
      checkpoint: input.checkpoint,
    });
    await this.deps.runs.update(input.runId, {
      outcome: "paused_for_approval",
      completedAt: new Date(),
    });

    return pause;
  }

  // -------------------------------------------------------------------------
  // resumeAfterApproval
  // -------------------------------------------------------------------------

  async resumeAfterApproval(
    approvalId: string,
    approvalOutcome: Record<string, unknown>,
  ): Promise<ResumeResult | null> {
    const pause = await this.deps.pauses.getByApprovalId(approvalId);
    if (!pause) return null;

    if (pause.resumeStatus !== "pending") {
      throw new ConcurrentResumeError(pause.id);
    }

    // CAS: atomically transition pending → consumed
    const swapped = await this.deps.pauses.compareAndSwapResumeStatus(
      pause.id,
      "pending",
      "consumed",
      { approvalOutcome, resumedAt: new Date() },
    );
    if (!swapped) {
      throw new ConcurrentResumeError(pause.id);
    }

    const session = await this.requireSession(pause.sessionId);
    if (session.status !== "paused") {
      throw new Error(
        `Cannot resume session ${session.id}: status is ${session.status}, expected paused`,
      );
    }

    const existingRuns = await this.deps.runs.listBySession(session.id);
    const runIndex = existingRuns.length;

    const run: AgentRun = {
      id: randomUUID(),
      sessionId: session.id,
      runIndex,
      triggerType: "resume_approval",
      resumeContext: approvalOutcome,
      outcome: null,
      stepRange: null,
      startedAt: new Date(),
      completedAt: null,
    };

    await this.deps.runs.save(run);
    await this.deps.sessions.update(session.id, { status: "running" });

    const updatedSession = await this.requireSession(session.id);
    return { session: updatedSession, run, resumeToken: pause.resumeToken };
  }

  // -------------------------------------------------------------------------
  // completeSession
  // -------------------------------------------------------------------------

  async completeSession(sessionId: string, opts: { runId: string }): Promise<void> {
    const session = await this.requireSession(sessionId);
    this.assertTransition(session.status, "completed");

    const now = new Date();
    await this.deps.sessions.update(sessionId, { status: "completed", completedAt: now });
    await this.deps.runs.update(opts.runId, { outcome: "completed", completedAt: now });
  }

  // -------------------------------------------------------------------------
  // failSession
  // -------------------------------------------------------------------------

  async failSession(sessionId: string, opts: { runId: string; error?: string }): Promise<void> {
    const session = await this.requireSession(sessionId);
    this.assertTransition(session.status, "failed");

    const now = new Date();
    await this.deps.sessions.update(sessionId, {
      status: "failed",
      completedAt: now,
    });
    await this.deps.runs.update(opts.runId, { outcome: "failed", completedAt: now });
  }

  // -------------------------------------------------------------------------
  // cancelSession
  // -------------------------------------------------------------------------

  async cancelSession(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    this.assertTransition(session.status, "cancelled");

    const pauses = await this.deps.pauses.listBySession(sessionId);
    for (const p of pauses) {
      if (p.resumeStatus === "pending") {
        await this.deps.pauses.update(p.id, { resumeStatus: "cancelled" });
      }
    }

    const runs = await this.deps.runs.listBySession(sessionId);
    const now = new Date();
    for (const run of runs) {
      if (run.outcome === null) {
        await this.deps.runs.update(run.id, { outcome: "cancelled", completedAt: now });
      }
    }

    await this.deps.sessions.update(sessionId, { status: "cancelled", completedAt: now });
  }

  // -------------------------------------------------------------------------
  // Read-only accessors
  // -------------------------------------------------------------------------

  /** Ordered by runIndex ascending */
  async listRunsForSession(sessionId: string): Promise<AgentRun[]> {
    return this.deps.runs.listBySession(sessionId);
  }

  async getSession(sessionId: string): Promise<AgentSession | null> {
    return this.deps.sessions.getById(sessionId);
  }

  async getToolHistory(sessionId: string): Promise<ToolEvent[]> {
    return this.deps.toolEvents.listBySession(sessionId);
  }

  async getPauseByResumeToken(sessionId: string, resumeToken: string): Promise<AgentPause | null> {
    const pauses = await this.deps.pauses.listBySession(sessionId);
    return pauses.find((p) => p.resumeToken === resumeToken) ?? null;
  }

  /**
   * Ensure runId belongs to the session and has not completed (callback / gateway binding).
   */
  async verifyActiveRunForSession(sessionId: string, runId: string): Promise<void> {
    const run = await this.deps.runs.getById(runId);
    if (!run || run.sessionId !== sessionId) {
      throw new Error(`Run ${runId} not found for session ${sessionId}`);
    }
    if (run.outcome !== null) {
      throw new Error(`Run ${runId} is already terminal (outcome=${run.outcome})`);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async requireSession(id: string): Promise<AgentSession> {
    const session = await this.deps.sessions.getById(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  }

  private assertNotTerminal(session: AgentSession): void {
    const terminal = ["completed", "failed", "cancelled"];
    if (terminal.includes(session.status)) {
      throw new Error(`Session ${session.id} is in terminal state: ${session.status}`);
    }
  }

  private assertTransition(from: AgentSession["status"], to: AgentSession["status"]): void {
    if (!canTransition(from, to)) {
      throw new SessionTransitionError(from, to);
    }
  }
}
