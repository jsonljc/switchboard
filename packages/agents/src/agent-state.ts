// ---------------------------------------------------------------------------
// Agent State Tracker — powers dashboard UI activity status
// ---------------------------------------------------------------------------

export type ActivityStatus = "idle" | "working" | "analyzing" | "waiting_approval" | "error";

export interface AgentActivityState {
  agentId: string;
  activityStatus: ActivityStatus;
  currentTask: string | null;
  lastActionSummary: string | null;
  lastActiveAt: string | null;
  lastError: string | null;
  eventsProcessed: number;
}

export type StateChangeListener = (
  organizationId: string,
  agentId: string,
  state: AgentActivityState,
) => void;

export class AgentStateTracker {
  private states = new Map<string, Map<string, AgentActivityState>>();
  private listeners: StateChangeListener[] = [];

  get(organizationId: string, agentId: string): AgentActivityState | undefined {
    return this.states.get(organizationId)?.get(agentId);
  }

  listForOrg(organizationId: string): AgentActivityState[] {
    const orgMap = this.states.get(organizationId);
    return orgMap ? [...orgMap.values()] : [];
  }

  startProcessing(organizationId: string, agentId: string, task: string): void {
    this.update(organizationId, agentId, {
      activityStatus: "working",
      currentTask: task,
    });
  }

  completeProcessing(organizationId: string, agentId: string, summary: string): void {
    const current = this.getOrCreate(organizationId, agentId);
    this.update(organizationId, agentId, {
      activityStatus: "idle",
      currentTask: null,
      lastActionSummary: summary,
      lastActiveAt: new Date().toISOString(),
      eventsProcessed: current.eventsProcessed + 1,
    });
  }

  setError(organizationId: string, agentId: string, error: string): void {
    this.update(organizationId, agentId, {
      activityStatus: "error",
      lastError: error,
    });
  }

  setWaitingApproval(organizationId: string, agentId: string, task: string): void {
    this.update(organizationId, agentId, {
      activityStatus: "waiting_approval",
      currentTask: task,
    });
  }

  remove(organizationId: string, agentId: string): void {
    this.states.get(organizationId)?.delete(agentId);
  }

  clearOrg(organizationId: string): void {
    this.states.delete(organizationId);
  }

  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  private getOrCreate(organizationId: string, agentId: string): AgentActivityState {
    let orgMap = this.states.get(organizationId);
    if (!orgMap) {
      orgMap = new Map();
      this.states.set(organizationId, orgMap);
    }

    let state = orgMap.get(agentId);
    if (!state) {
      state = {
        agentId,
        activityStatus: "idle",
        currentTask: null,
        lastActionSummary: null,
        lastActiveAt: null,
        lastError: null,
        eventsProcessed: 0,
      };
      orgMap.set(agentId, state);
    }

    return state;
  }

  private update(
    organizationId: string,
    agentId: string,
    partial: Partial<AgentActivityState>,
  ): void {
    const state = this.getOrCreate(organizationId, agentId);
    Object.assign(state, partial);
    for (const listener of this.listeners) {
      try {
        listener(organizationId, agentId, state);
      } catch {
        // Listener errors must not crash state updates
      }
    }
  }
}
