import type {
  AgentSession,
  AgentRun,
  AgentPause,
  ToolEvent,
  AgentRoleOverride,
  SessionStatus,
  ResumeStatus,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export interface SessionStore {
  create(session: AgentSession): Promise<void>;
  getById(id: string): Promise<AgentSession | null>;
  update(id: string, updates: Partial<AgentSession>): Promise<void>;
  list(filter: {
    organizationId?: string;
    roleId?: string;
    status?: SessionStatus;
    principalId?: string;
    limit?: number;
  }): Promise<AgentSession[]>;
  /** Count active (non-terminal) sessions for concurrency limiting */
  countActive(filter: { organizationId: string; roleId?: string }): Promise<number>;
}

// ---------------------------------------------------------------------------
// RunStore
// ---------------------------------------------------------------------------

export interface RunStore {
  save(run: AgentRun): Promise<void>;
  getById(id: string): Promise<AgentRun | null>;
  update(id: string, updates: Partial<AgentRun>): Promise<void>;
  listBySession(sessionId: string): Promise<AgentRun[]>;
}

// ---------------------------------------------------------------------------
// PauseStore
// ---------------------------------------------------------------------------

export interface PauseStore {
  save(pause: AgentPause): Promise<void>;
  getById(id: string): Promise<AgentPause | null>;
  /** Lookup pause by the approval that caused it (for resume hook) */
  getByApprovalId(approvalId: string): Promise<AgentPause | null>;
  update(id: string, updates: Partial<AgentPause>): Promise<void>;
  listBySession(sessionId: string): Promise<AgentPause[]>;
  /**
   * Atomic CAS: transition resumeStatus from expectedStatus to newStatus.
   * Returns true if the update succeeded (status matched), false if it didn't
   * (concurrent resume). This follows the same optimistic concurrency pattern
   * as PrismaApprovalStore.updateState with expectedVersion.
   */
  compareAndSwapResumeStatus(
    id: string,
    expectedStatus: ResumeStatus,
    newStatus: ResumeStatus,
    updates?: Partial<AgentPause>,
  ): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// ToolEventStore
// ---------------------------------------------------------------------------

export interface ToolEventStore {
  record(event: ToolEvent): Promise<void>;
  listBySession(sessionId: string): Promise<ToolEvent[]>;
  listByRun(runId: string): Promise<ToolEvent[]>;
  /** Count for safetyEnvelope checks without loading all records */
  countBySession(sessionId: string): Promise<{
    totalCalls: number;
    mutations: number;
    dollarsAtRisk: number;
  }>;
}

// ---------------------------------------------------------------------------
// RoleOverrideStore
// ---------------------------------------------------------------------------

export interface RoleOverrideStore {
  save(override: AgentRoleOverride): Promise<void>;
  getByOrgAndRole(organizationId: string, roleId: string): Promise<AgentRoleOverride | null>;
  update(id: string, updates: Partial<AgentRoleOverride>): Promise<void>;
}
