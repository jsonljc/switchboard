// ---------------------------------------------------------------------------
// Agent Registry — tracks which agents are installed/active per organization
// ---------------------------------------------------------------------------

export type AgentStatus = "draft" | "active" | "paused" | "error" | "disabled";
export type AgentHealth = "healthy" | "degraded" | "offline";

export interface AgentRuntime {
  provider: "openclaw";
  sessionId?: string;
  health?: AgentHealth;
  lastHeartbeatAt?: string;
}

export interface AgentRegistryEntry {
  agentId: string;
  version: string;
  installed: boolean;
  status: AgentStatus;
  config: Record<string, unknown>;
  capabilities: {
    accepts: string[];
    emits: string[];
    tools: string[];
  };
  runtime?: AgentRuntime;
  lastActiveAt?: string;
}

type RegistrationInput = Omit<AgentRegistryEntry, "lastActiveAt">;

export class AgentRegistry {
  private entries = new Map<string, Map<string, AgentRegistryEntry>>();

  register(organizationId: string, entry: RegistrationInput): void {
    let orgMap = this.entries.get(organizationId);
    if (!orgMap) {
      orgMap = new Map();
      this.entries.set(organizationId, orgMap);
    }
    orgMap.set(entry.agentId, { ...entry, lastActiveAt: undefined });
  }

  get(organizationId: string, agentId: string): AgentRegistryEntry | undefined {
    return this.entries.get(organizationId)?.get(agentId);
  }

  listAll(organizationId: string): AgentRegistryEntry[] {
    const orgMap = this.entries.get(organizationId);
    return orgMap ? [...orgMap.values()] : [];
  }

  listActive(organizationId: string): AgentRegistryEntry[] {
    return this.listAll(organizationId).filter((e) => e.status === "active");
  }

  findByInboundEvent(organizationId: string, eventType: string): AgentRegistryEntry[] {
    return this.listActive(organizationId).filter((e) =>
      e.capabilities.accepts.includes(eventType),
    );
  }

  updateStatus(organizationId: string, agentId: string, status: AgentStatus): void {
    const entry = this.get(organizationId, agentId);
    if (entry) {
      entry.status = status;
      if (status === "active") {
        entry.lastActiveAt = new Date().toISOString();
      }
    }
  }

  updateRuntime(organizationId: string, agentId: string, runtime: AgentRuntime): void {
    const entry = this.get(organizationId, agentId);
    if (entry) {
      entry.runtime = runtime;
    }
  }

  updateConfig(organizationId: string, agentId: string, config: Record<string, unknown>): void {
    const entry = this.get(organizationId, agentId);
    if (entry) {
      entry.config = config;
    }
  }

  remove(organizationId: string, agentId: string): boolean {
    const orgMap = this.entries.get(organizationId);
    return orgMap?.delete(agentId) ?? false;
  }
}
