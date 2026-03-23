import {
  CommandInterpreter,
  CommandGuardrailEvaluator,
  CommandRouter,
  SummaryFormatter,
} from "@switchboard/agents";
import type { OperatorCommandStore } from "@switchboard/core";
import type { CommandLLM } from "@switchboard/agents";

export interface OperatorDeps {
  interpreter: CommandInterpreter;
  guardrailEvaluator: CommandGuardrailEvaluator;
  router: CommandRouter;
  formatter: SummaryFormatter;
  commandStore: OperatorCommandStore;
}

export interface BuildOperatorDepsOptions {
  commandStore: OperatorCommandStore;
  llm?: CommandLLM;
  workflowSpawner?: import("@switchboard/agents").WorkflowSpawner;
  agentQueryHandlers?: Record<string, import("@switchboard/agents").AgentQueryHandler>;
}

export function buildOperatorDeps(options: BuildOperatorDepsOptions): OperatorDeps {
  const stubLLM: CommandLLM = {
    async parseCommand() {
      console.warn(
        "[OperatorDeps] No LLM configured — all commands will be rejected. Pass llm option to buildOperatorDeps.",
      );
      return {
        intent: "unknown",
        entities: [],
        parameters: {},
        confidence: 0,
        ambiguityFlags: ["no_llm_configured"],
      };
    },
  };

  return {
    interpreter: new CommandInterpreter({ llm: options.llm ?? stubLLM }),
    guardrailEvaluator: new CommandGuardrailEvaluator(),
    router: new CommandRouter({
      workflowSpawner: options.workflowSpawner,
      agentQueryHandlers: options.agentQueryHandlers,
    }),
    formatter: new SummaryFormatter(),
    commandStore: options.commandStore,
  };
}
