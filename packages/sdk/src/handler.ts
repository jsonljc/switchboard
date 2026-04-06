import type { AgentContext } from "./context.js";

export interface AgentHandler {
  onMessage?(ctx: AgentContext): Promise<void>;
  onTask?(ctx: AgentContext): Promise<void>;
  onSetup?(ctx: AgentContext): Promise<void>;
  onSchedule?(ctx: AgentContext): Promise<void>;
  onHandoff?(ctx: AgentContext): Promise<void>;
}
