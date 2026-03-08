// ---------------------------------------------------------------------------
// Agent Layer — Types & Interfaces
// ---------------------------------------------------------------------------
// Defines the contract for autonomous agents that observe ad account health,
// decide on actions, and execute them through governance.
// ---------------------------------------------------------------------------

import type { AdsOperatorConfig } from "@switchboard/schemas";
import type { RuntimeOrchestrator } from "../orchestrator/index.js";
import type { StorageContext } from "../storage/index.js";

export interface AgentContext {
  config: AdsOperatorConfig;
  orchestrator: RuntimeOrchestrator;
  storage: StorageContext;
  notifier: AgentNotifier;
}

export interface AgentTickResult {
  agentId: string;
  actions: Array<{ actionType: string; outcome: string }>;
  summary: string;
  nextTickAt?: Date;
}

export interface AdsAgent {
  readonly id: string;
  readonly name: string;
  tick(ctx: AgentContext): Promise<AgentTickResult>;
}

export interface AgentNotifier {
  sendProactive(chatId: string, channelType: string, message: string): Promise<void>;
}
