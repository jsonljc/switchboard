import type { OperatorChannel } from "@switchboard/schemas";
import type { CommandLLM, InterpretResult } from "./operator-types.js";

export interface CommandInterpreterDeps {
  llm: CommandLLM;
}

const FALLBACK_RESULT: InterpretResult = {
  intent: "unknown",
  entities: [],
  parameters: {},
  confidence: 0,
  ambiguityFlags: ["llm_error"],
};

export class CommandInterpreter {
  private readonly llm: CommandLLM;

  constructor(deps: CommandInterpreterDeps) {
    this.llm = deps.llm;
  }

  async interpret(
    rawInput: string,
    context: { organizationId: string; channel: OperatorChannel },
  ): Promise<InterpretResult> {
    try {
      return await this.llm.parseCommand(rawInput, context);
    } catch (err) {
      console.error("[CommandInterpreter] LLM parse error:", err);
      return { ...FALLBACK_RESULT };
    }
  }
}
