import { describe, it, expect, vi } from "vitest";
import { CommandInterpreter } from "../command-interpreter.js";
import type { CommandLLM, InterpretResult } from "../operator-types.js";

function mockLLM(result: InterpretResult): CommandLLM {
  return {
    parseCommand: vi.fn().mockResolvedValue(result),
  };
}

describe("CommandInterpreter", () => {
  const baseContext = { organizationId: "org-1", channel: "telegram" as const };

  it("parses a high-confidence command via LLM", async () => {
    const llm = mockLLM({
      intent: "follow_up_leads",
      entities: [{ type: "lead_segment", filter: { score: { gte: 70 } } }],
      parameters: {},
      confidence: 0.95,
      ambiguityFlags: [],
    });

    const interpreter = new CommandInterpreter({ llm });
    const result = await interpreter.interpret("follow up with hot leads", baseContext);

    expect(result.intent).toBe("follow_up_leads");
    expect(result.confidence).toBe(0.95);
    expect(result.ambiguityFlags).toHaveLength(0);
    expect(llm.parseCommand).toHaveBeenCalledWith("follow up with hot leads", baseContext);
  });

  it("returns low confidence when LLM is uncertain", async () => {
    const llm = mockLLM({
      intent: "show_pipeline",
      entities: [],
      parameters: {},
      confidence: 0.3,
      ambiguityFlags: ["vague_input"],
    });

    const interpreter = new CommandInterpreter({ llm });
    const result = await interpreter.interpret("what's going on", baseContext);

    expect(result.confidence).toBeLessThan(0.5);
    expect(result.ambiguityFlags).toContain("vague_input");
  });

  it("catches LLM errors and returns a safe fallback", async () => {
    const llm: CommandLLM = {
      parseCommand: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    };

    const interpreter = new CommandInterpreter({ llm });
    const result = await interpreter.interpret("do something", baseContext);

    expect(result.confidence).toBe(0);
    expect(result.intent).toBe("unknown");
    expect(result.ambiguityFlags).toContain("llm_error");
  });
});
