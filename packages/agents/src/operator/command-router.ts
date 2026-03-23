import type { OperatorCommand } from "@switchboard/schemas";
import { READ_ONLY_INTENTS, INTENT_AGENT_MAP } from "./operator-types.js";
import type { CommandRouterResult } from "./operator-types.js";

export type AgentQueryHandler = (
  organizationId: string,
  parameters: Record<string, unknown>,
  entities: { type: string; id?: string; filter?: Record<string, unknown> }[],
) => Promise<Record<string, unknown>>;

export type WorkflowSpawner = (
  organizationId: string,
  intent: string,
  sourceAgent: string,
  entities: { type: string; id?: string; filter?: Record<string, unknown> }[],
  parameters: Record<string, unknown>,
) => Promise<string>;

export interface CommandRouterDeps {
  agentQueryHandlers?: Record<string, AgentQueryHandler>;
  workflowSpawner?: WorkflowSpawner;
}

export class CommandRouter {
  private readonly queryHandlers: Record<string, AgentQueryHandler>;
  private readonly workflowSpawner?: WorkflowSpawner;

  constructor(deps: CommandRouterDeps) {
    this.queryHandlers = deps.agentQueryHandlers ?? {};
    this.workflowSpawner = deps.workflowSpawner;
  }

  async dispatch(command: OperatorCommand): Promise<CommandRouterResult> {
    if (READ_ONLY_INTENTS.has(command.intent)) {
      return this.handleReadOnly(command);
    }
    return this.handleWriteCommand(command);
  }

  private async handleReadOnly(command: OperatorCommand): Promise<CommandRouterResult> {
    const handler = this.queryHandlers[command.intent];
    if (!handler) {
      return {
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: `No query handler for intent: ${command.intent}`,
      };
    }

    try {
      const data = await handler(command.organizationId, command.parameters, command.entities);
      const summary = JSON.stringify(data);
      return { success: true, workflowIds: [], resultSummary: summary };
    } catch (err) {
      return {
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleWriteCommand(command: OperatorCommand): Promise<CommandRouterResult> {
    if (!this.workflowSpawner) {
      return {
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: "Workflow execution not available",
      };
    }

    const sourceAgent = INTENT_AGENT_MAP[command.intent] ?? "operator";

    try {
      const workflowId = await this.workflowSpawner(
        command.organizationId,
        command.intent,
        sourceAgent,
        command.entities,
        command.parameters,
      );
      return {
        success: true,
        workflowIds: [workflowId],
        resultSummary: `Workflow ${workflowId} started for ${command.intent}`,
      };
    } catch (err) {
      return {
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
