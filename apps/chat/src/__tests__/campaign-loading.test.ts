import { describe, it, expect } from "vitest";
import { ClinicInterpreter } from "../clinic/interpreter.js";
import type { LLMConfig, LLMResponse } from "../interpreter/llm-base.js";
import type { ClinicContext } from "../clinic/types.js";

const DEFAULT_CONFIG: LLMConfig = {
  apiKey: "test-key",
  model: "claude-3-5-haiku-20241022",
  maxTokens: 512,
  temperature: 0.0,
  baseUrl: "https://api.anthropic.com",
};

/**
 * Testable subclass that captures the built prompt for inspection.
 */
class PromptCapturingInterpreter extends ClinicInterpreter {
  public lastPrompt: string = "";
  private mockResponse: string = "{}";

  constructor(config: LLMConfig, context: ClinicContext) {
    super(config, context);
  }

  setMockResponse(json: object): void {
    this.mockResponse = JSON.stringify(json);
  }

  protected buildPrompt(
    text: string,
    conversationContext: Record<string, unknown>,
    availableActions: string[],
  ): string {
    this.lastPrompt = super.buildPrompt(text, conversationContext, availableActions);
    return this.lastPrompt;
  }

  protected async callLLM(_prompt: string): Promise<LLMResponse> {
    return {
      text: this.mockResponse,
      usage: { promptTokens: 100, completionTokens: 50 },
    };
  }
}

const ALL_ACTIONS = [
  "ads.campaign.pause",
  "ads.campaign.resume",
  "ads.budget.adjust",
];

describe("Campaign name loading and prompt grounding", () => {
  let interpreter: PromptCapturingInterpreter;

  describe("updateCampaignNames", () => {
    it("updates campaign names that appear in the system prompt", async () => {
      const context: ClinicContext = {
        adAccountId: "act_12345",
        campaignNames: [],
      };
      interpreter = new PromptCapturingInterpreter(DEFAULT_CONFIG, context);
      interpreter.setMockResponse({
        intent: "report_performance",
        confidence: 0.9,
        slots: {},
        reasoning: "test",
      });

      // Before update — no campaigns loaded
      await interpreter.interpret("how are my campaigns?", {}, ALL_ACTIONS);
      expect(interpreter.lastPrompt).toContain("(no campaigns loaded yet)");

      // Update campaign names
      interpreter.updateCampaignNames(["Botox Promo", "Filler Special", "Laser Treatment"]);

      // After update — campaign names should appear in prompt
      await interpreter.interpret("how are my campaigns?", {}, ALL_ACTIONS);
      expect(interpreter.lastPrompt).toContain("- Botox Promo");
      expect(interpreter.lastPrompt).toContain("- Filler Special");
      expect(interpreter.lastPrompt).toContain("- Laser Treatment");
      expect(interpreter.lastPrompt).not.toContain("(no campaigns loaded yet)");
    });

    it("shows placeholder when campaign names array is empty", async () => {
      const context: ClinicContext = {
        adAccountId: "act_12345",
      };
      interpreter = new PromptCapturingInterpreter(DEFAULT_CONFIG, context);
      interpreter.setMockResponse({
        intent: "check_status",
        confidence: 0.9,
        slots: {},
        reasoning: "test",
      });

      await interpreter.interpret("check campaign status", {}, ALL_ACTIONS);
      expect(interpreter.lastPrompt).toContain("(no campaigns loaded yet)");
    });

    it("replaces previous campaign names on subsequent calls", async () => {
      const context: ClinicContext = {
        adAccountId: "act_12345",
        campaignNames: ["Old Campaign"],
      };
      interpreter = new PromptCapturingInterpreter(DEFAULT_CONFIG, context);
      interpreter.setMockResponse({
        intent: "report_performance",
        confidence: 0.9,
        slots: {},
        reasoning: "test",
      });

      await interpreter.interpret("report", {}, ALL_ACTIONS);
      expect(interpreter.lastPrompt).toContain("- Old Campaign");

      // Update with new names
      interpreter.updateCampaignNames(["New Campaign A", "New Campaign B"]);

      await interpreter.interpret("report", {}, ALL_ACTIONS);
      expect(interpreter.lastPrompt).toContain("- New Campaign A");
      expect(interpreter.lastPrompt).toContain("- New Campaign B");
      expect(interpreter.lastPrompt).not.toContain("- Old Campaign");
    });
  });

  describe("buildPrompt includes ad account ID", () => {
    it("includes the ad account ID in the prompt", async () => {
      const context: ClinicContext = {
        adAccountId: "act_99999",
        campaignNames: ["Test Campaign"],
      };
      interpreter = new PromptCapturingInterpreter(DEFAULT_CONFIG, context);
      interpreter.setMockResponse({
        intent: "report_performance",
        confidence: 0.9,
        slots: {},
        reasoning: "test",
      });

      await interpreter.interpret("how are my ads?", {}, ALL_ACTIONS);
      expect(interpreter.lastPrompt).toContain("act_99999");
    });
  });
});
