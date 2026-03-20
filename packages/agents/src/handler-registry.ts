// ---------------------------------------------------------------------------
// Handler Registry — maps agent IDs to handler instances
// ---------------------------------------------------------------------------

import type { AgentHandler } from "./ports.js";

export class HandlerRegistry {
  private handlers = new Map<string, AgentHandler>();

  register(agentId: string, handler: AgentHandler): void {
    this.handlers.set(agentId, handler);
  }

  get(agentId: string): AgentHandler | undefined {
    return this.handlers.get(agentId);
  }

  has(agentId: string): boolean {
    return this.handlers.has(agentId);
  }

  listRegistered(): string[] {
    return [...this.handlers.keys()];
  }

  remove(agentId: string): boolean {
    return this.handlers.delete(agentId);
  }
}
