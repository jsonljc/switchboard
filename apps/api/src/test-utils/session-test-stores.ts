/**
 * In-memory session stores for API-layer tests (mirrors core test harness).
 */
import type {
  AgentSession,
  AgentRun,
  AgentPause,
  ToolEvent,
  AgentRoleOverride,
  SessionStatus,
  ResumeStatus,
} from "@switchboard/schemas";
import type {
  SessionStore,
  RunStore,
  PauseStore,
  ToolEventStore,
  RoleOverrideStore,
} from "@switchboard/core/sessions";

export class InMemorySessionStore implements SessionStore {
  readonly items: Map<string, AgentSession> = new Map();

  async create(session: AgentSession): Promise<void> {
    this.items.set(session.id, { ...session });
  }

  async getById(id: string): Promise<AgentSession | null> {
    const s = this.items.get(id);
    return s ? { ...s } : null;
  }

  async update(id: string, updates: Partial<AgentSession>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Session ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async list(filter: {
    organizationId?: string;
    roleId?: string;
    status?: SessionStatus;
    principalId?: string;
    limit?: number;
  }): Promise<AgentSession[]> {
    let results = [...this.items.values()];
    if (filter.organizationId)
      results = results.filter((s) => s.organizationId === filter.organizationId);
    if (filter.roleId) results = results.filter((s) => s.roleId === filter.roleId);
    if (filter.status) results = results.filter((s) => s.status === filter.status);
    if (filter.principalId) results = results.filter((s) => s.principalId === filter.principalId);
    if (filter.limit) results = results.slice(0, filter.limit);
    return results;
  }

  async countActive(filter: { organizationId: string; roleId?: string }): Promise<number> {
    let results = [...this.items.values()].filter(
      (s) =>
        s.organizationId === filter.organizationId &&
        (s.status === "running" || s.status === "paused"),
    );
    if (filter.roleId) results = results.filter((s) => s.roleId === filter.roleId);
    return results.length;
  }

  async createIfUnderLimit(session: AgentSession, maxConcurrent: number): Promise<boolean> {
    const active = await this.countActive({
      organizationId: session.organizationId,
      roleId: session.roleId,
    });
    if (active >= maxConcurrent) return false;
    this.items.set(session.id, { ...session });
    return true;
  }
}

export class InMemoryRunStore implements RunStore {
  readonly items: Map<string, AgentRun> = new Map();

  async save(run: AgentRun): Promise<void> {
    this.items.set(run.id, { ...run });
  }

  async getById(id: string): Promise<AgentRun | null> {
    const r = this.items.get(id);
    return r ? { ...r } : null;
  }

  async update(id: string, updates: Partial<AgentRun>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Run ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async listBySession(sessionId: string): Promise<AgentRun[]> {
    return [...this.items.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.runIndex - b.runIndex);
  }
}

export class InMemoryPauseStore implements PauseStore {
  readonly items: Map<string, AgentPause> = new Map();

  async save(pause: AgentPause): Promise<void> {
    this.items.set(pause.id, { ...pause });
  }

  async getById(id: string): Promise<AgentPause | null> {
    const p = this.items.get(id);
    return p ? { ...p } : null;
  }

  async getByApprovalId(approvalId: string): Promise<AgentPause | null> {
    const p = [...this.items.values()].find((x) => x.approvalId === approvalId);
    return p ? { ...p } : null;
  }

  async update(id: string, updates: Partial<AgentPause>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Pause ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async listBySession(sessionId: string): Promise<AgentPause[]> {
    return [...this.items.values()]
      .filter((p) => p.sessionId === sessionId)
      .sort((a, b) => a.pauseIndex - b.pauseIndex);
  }

  async compareAndSwapResumeStatus(
    id: string,
    expectedStatus: ResumeStatus,
    newStatus: ResumeStatus,
    updates?: Partial<AgentPause>,
  ): Promise<boolean> {
    const existing = this.items.get(id);
    if (!existing || existing.resumeStatus !== expectedStatus) return false;
    this.items.set(id, { ...existing, ...updates, resumeStatus: newStatus });
    return true;
  }
}

export class InMemoryToolEventStore implements ToolEventStore {
  readonly items: ToolEvent[] = [];

  async record(event: ToolEvent): Promise<void> {
    this.items.push({ ...event });
  }

  async findByGatewayIdempotencyKey(
    sessionId: string,
    gatewayIdempotencyKey: string,
  ): Promise<ToolEvent | null> {
    const e = this.items.find(
      (ev) => ev.sessionId === sessionId && ev.gatewayIdempotencyKey === gatewayIdempotencyKey,
    );
    return e ? { ...e } : null;
  }

  async listBySession(sessionId: string): Promise<ToolEvent[]> {
    return this.items
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => a.stepIndex - b.stepIndex);
  }

  async listByRun(runId: string): Promise<ToolEvent[]> {
    return this.items.filter((e) => e.runId === runId).sort((a, b) => a.stepIndex - b.stepIndex);
  }

  async countBySession(
    sessionId: string,
  ): Promise<{ totalCalls: number; mutations: number; dollarsAtRisk: number }> {
    const events = this.items.filter((e) => e.sessionId === sessionId);
    return {
      totalCalls: events.length,
      mutations: events.filter((e) => e.isMutation).length,
      dollarsAtRisk: events.reduce((sum, e) => sum + e.dollarsAtRisk, 0),
    };
  }
}

export class InMemoryRoleOverrideStore implements RoleOverrideStore {
  readonly items: Map<string, AgentRoleOverride> = new Map();

  async save(override: AgentRoleOverride): Promise<void> {
    this.items.set(override.id, { ...override });
  }

  async getByOrgAndRole(organizationId: string, roleId: string): Promise<AgentRoleOverride | null> {
    const o = [...this.items.values()].find(
      (x) => x.organizationId === organizationId && x.roleId === roleId,
    );
    return o ? { ...o } : null;
  }

  async update(id: string, updates: Partial<AgentRoleOverride>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Override ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }
}

export interface SessionTestStores {
  sessions: InMemorySessionStore;
  runs: InMemoryRunStore;
  pauses: InMemoryPauseStore;
  toolEvents: InMemoryToolEventStore;
  roleOverrides: InMemoryRoleOverrideStore;
}

export function createSessionTestStores(): SessionTestStores {
  return {
    sessions: new InMemorySessionStore(),
    runs: new InMemoryRunStore(),
    pauses: new InMemoryPauseStore(),
    toolEvents: new InMemoryToolEventStore(),
    roleOverrides: new InMemoryRoleOverrideStore(),
  };
}
