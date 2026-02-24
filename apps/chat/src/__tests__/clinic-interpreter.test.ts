import { describe, it, expect, beforeEach } from "vitest";
import { ClinicInterpreter } from "../clinic/interpreter.js";
import { AllowedIntent } from "../clinic/types.js";
import { ModelRouter } from "../clinic/model-router.js";
import type { LLMConfig, LLMResponse } from "../interpreter/llm-base.js";
import type { ClinicContext } from "../clinic/types.js";

const ALL_ACTIONS = [
  "ads.campaign.pause",
  "ads.campaign.resume",
  "ads.budget.adjust",
  "system.undo",
];

const DEFAULT_CONFIG: LLMConfig = {
  apiKey: "test-key",
  model: "claude-3-5-haiku-20241022",
  maxTokens: 512,
  temperature: 0.0,
  baseUrl: "https://api.anthropic.com",
};

const DEFAULT_CONTEXT: ClinicContext = {
  adAccountId: "act_12345",
  campaignNames: ["Summer Sale", "Winter Promo"],
  clinicName: "Test Clinic",
};

/**
 * Testable subclass that overrides callLLM to return canned responses.
 */
class TestableClinicInterpreter extends ClinicInterpreter {
  private mockResponse: string = "{}";

  constructor(
    config: LLMConfig,
    context: ClinicContext,
    modelRouter?: ModelRouter,
  ) {
    super(config, context, modelRouter);
  }

  setMockResponse(json: object): void {
    this.mockResponse = JSON.stringify(json);
  }

  protected async callLLM(_prompt: string): Promise<LLMResponse> {
    return {
      text: this.mockResponse,
      usage: { promptTokens: 100, completionTokens: 50 },
    };
  }
}

describe("ClinicInterpreter", () => {
  let interpreter: TestableClinicInterpreter;

  beforeEach(() => {
    interpreter = new TestableClinicInterpreter(DEFAULT_CONFIG, DEFAULT_CONTEXT);
  });

  // ---------------------------------------------------------------------------
  // Read intents
  // ---------------------------------------------------------------------------
  describe("read intents", () => {
    it("classifies report_performance as read intent with no proposals", async () => {
      interpreter.setMockResponse({
        intent: "report_performance",
        confidence: 0.95,
        slots: {},
        reasoning: "User wants campaign report",
      });

      const result = await interpreter.interpret(
        "how are my campaigns doing?",
        {},
        ALL_ACTIONS,
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.readIntent).toBeDefined();
      expect(result.readIntent!.intent).toBe(AllowedIntent.REPORT_PERFORMANCE);
      expect(result.readIntent!.confidence).toBe(0.95);
      expect(result.needsClarification).toBe(false);
    });

    it("classifies check_status with campaignRef slot", async () => {
      interpreter.setMockResponse({
        intent: "check_status",
        confidence: 0.9,
        slots: { campaignRef: "Summer Sale" },
        reasoning: "User asking about specific campaign",
      });

      const result = await interpreter.interpret(
        "what's the status of Summer Sale?",
        {},
        ALL_ACTIONS,
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.readIntent).toBeDefined();
      expect(result.readIntent!.intent).toBe(AllowedIntent.CHECK_STATUS);
      expect(result.readIntent!.slots["campaignRef"]).toBe("Summer Sale");
    });

    it("classifies more_leads as read intent", async () => {
      interpreter.setMockResponse({
        intent: "more_leads",
        confidence: 0.85,
        slots: {},
        reasoning: "User wants more patient leads",
      });

      const result = await interpreter.interpret(
        "I want more patient leads",
        {},
        ALL_ACTIONS,
      );

      expect(result.readIntent).toBeDefined();
      expect(result.readIntent!.intent).toBe(AllowedIntent.MORE_LEADS);
    });

    it("classifies reduce_cost as read intent", async () => {
      interpreter.setMockResponse({
        intent: "reduce_cost",
        confidence: 0.9,
        slots: {},
        reasoning: "User wants to reduce ad costs",
      });

      const result = await interpreter.interpret(
        "reduce my ad costs",
        {},
        ALL_ACTIONS,
      );

      expect(result.readIntent).toBeDefined();
      expect(result.readIntent!.intent).toBe(AllowedIntent.REDUCE_COST);
    });
  });

  // ---------------------------------------------------------------------------
  // Write intents
  // ---------------------------------------------------------------------------
  describe("write intents", () => {
    it("classifies pause as write intent with ActionProposal", async () => {
      interpreter.setMockResponse({
        intent: "pause",
        confidence: 0.95,
        slots: { campaignRef: "Summer Sale" },
        reasoning: "User wants to pause campaign",
      });

      const result = await interpreter.interpret(
        "pause Summer Sale",
        {},
        ALL_ACTIONS,
      );

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.actionType).toBe("ads.campaign.pause");
      expect(result.proposals[0]!.parameters["campaignRef"]).toBe("Summer Sale");
      expect(result.readIntent).toBeUndefined();
      expect(result.needsClarification).toBe(false);
    });

    it("classifies resume as write intent with ActionProposal", async () => {
      interpreter.setMockResponse({
        intent: "resume",
        confidence: 0.9,
        slots: { campaignRef: "Winter Promo" },
        reasoning: "User wants to resume campaign",
      });

      const result = await interpreter.interpret(
        "resume Winter Promo",
        {},
        ALL_ACTIONS,
      );

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.actionType).toBe("ads.campaign.resume");
      expect(result.proposals[0]!.parameters["campaignRef"]).toBe("Winter Promo");
    });

    it("classifies adjust_budget with budget amount", async () => {
      interpreter.setMockResponse({
        intent: "adjust_budget",
        confidence: 0.9,
        slots: { campaignRef: "Summer Sale", budgetAmount: 500 },
        reasoning: "User wants to set budget",
      });

      const result = await interpreter.interpret(
        "set budget for Summer Sale to $500",
        {},
        ALL_ACTIONS,
      );

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.actionType).toBe("ads.budget.adjust");
      expect(result.proposals[0]!.parameters["campaignRef"]).toBe("Summer Sale");
      expect(result.proposals[0]!.parameters["newBudget"]).toBe(500);
    });

    it("returns needsClarification when action not in availableActions", async () => {
      interpreter.setMockResponse({
        intent: "pause",
        confidence: 0.95,
        slots: { campaignRef: "Summer Sale" },
        reasoning: "User wants to pause",
      });

      const result = await interpreter.interpret(
        "pause Summer Sale",
        {},
        ["ads.budget.adjust"], // pause not available
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.needsClarification).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Special intents
  // ---------------------------------------------------------------------------
  describe("special intents", () => {
    it("maps revert to system.undo proposal", async () => {
      interpreter.setMockResponse({
        intent: "revert",
        confidence: 0.95,
        slots: {},
        reasoning: "User wants to undo",
      });

      const result = await interpreter.interpret("undo", {}, ALL_ACTIONS);

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.actionType).toBe("system.undo");
      expect(result.proposals[0]!.parameters).toEqual({});
    });

    it("emits system.kill_switch proposal", async () => {
      interpreter.setMockResponse({
        intent: "kill_switch",
        confidence: 0.95,
        slots: {},
        reasoning: "User wants emergency stop",
      });

      const result = await interpreter.interpret(
        "stop everything now",
        {},
        ALL_ACTIONS,
      );

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]?.actionType).toBe("system.kill_switch");
      expect(result.confidence).toBe(0.95);
    });
  });

  // ---------------------------------------------------------------------------
  // Low confidence / unknown
  // ---------------------------------------------------------------------------
  describe("unknown and low confidence", () => {
    it("returns needsClarification for unknown intent", async () => {
      interpreter.setMockResponse({
        intent: "unknown",
        confidence: 0.2,
        slots: {},
        reasoning: "Not ad-related",
      });

      const result = await interpreter.interpret(
        "what's the weather?",
        {},
        ALL_ACTIONS,
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.needsClarification).toBe(true);
      expect(result.clarificationQuestion).toBeTruthy();
    });

    it("returns needsClarification for low confidence", async () => {
      interpreter.setMockResponse({
        intent: "pause",
        confidence: 0.3,
        slots: { campaignRef: "something" },
        reasoning: "Not sure",
      });

      const result = await interpreter.interpret(
        "maybe pause something",
        {},
        ALL_ACTIONS,
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.needsClarification).toBe(true);
    });

    it("maps invalid intent string to unknown", async () => {
      interpreter.setMockResponse({
        intent: "totally_invalid_intent",
        confidence: 0.8,
        slots: {},
        reasoning: "Bad intent",
      });

      const result = await interpreter.interpret(
        "do something",
        {},
        ALL_ACTIONS,
      );

      // Invalid intent → UNKNOWN → needsClarification
      expect(result.proposals).toHaveLength(0);
      expect(result.needsClarification).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // ModelRouter budget fallback
  // ---------------------------------------------------------------------------
  describe("ModelRouter fallback", () => {
    it("falls back to regex when budget exceeded", async () => {
      const router = new ModelRouter({
        dailyTokenBudget: 100,
        clinicId: "clinic_1",
      });
      // Exhaust the budget
      router.recordUsage(50, 60);

      const interpreterWithRouter = new TestableClinicInterpreter(
        DEFAULT_CONFIG,
        DEFAULT_CONTEXT,
        router,
      );
      // Should NOT be set, but if it were, regex fallback would ignore it
      interpreterWithRouter.setMockResponse({
        intent: "report_performance",
        confidence: 0.95,
        slots: {},
        reasoning: "Should not reach LLM",
      });

      const result = await interpreterWithRouter.interpret(
        "pause Summer Sale",
        {},
        ALL_ACTIONS,
      );

      // Regex fallback should match "pause" pattern
      expect(result.rawResponse).toContain("[FALLBACK_REGEX]");
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.actionType).toBe("ads.campaign.pause");
      expect(result.proposals[0]!.parameters["campaignRef"]).toBe("Summer Sale");
    });

    it("falls back to no-match message for unrecognized input when budget exceeded", async () => {
      const router = new ModelRouter({
        dailyTokenBudget: 100,
        clinicId: "clinic_1",
      });
      router.recordUsage(50, 60);

      const interpreterWithRouter = new TestableClinicInterpreter(
        DEFAULT_CONFIG,
        DEFAULT_CONTEXT,
        router,
      );

      const result = await interpreterWithRouter.interpret(
        "what's the weather?",
        {},
        ALL_ACTIONS,
      );

      expect(result.rawResponse).toContain("[FALLBACK_NO_MATCH]");
      expect(result.proposals).toHaveLength(0);
      expect(result.needsClarification).toBe(true);
      expect(result.clarificationQuestion).toContain("limited mode");
    });

    it("uses LLM when budget is not exceeded", async () => {
      const router = new ModelRouter({
        dailyTokenBudget: 100000,
        clinicId: "clinic_1",
      });

      const interpreterWithRouter = new TestableClinicInterpreter(
        DEFAULT_CONFIG,
        DEFAULT_CONTEXT,
        router,
      );
      interpreterWithRouter.setMockResponse({
        intent: "report_performance",
        confidence: 0.95,
        slots: {},
        reasoning: "User wants report",
      });

      const result = await interpreterWithRouter.interpret(
        "how are my campaigns?",
        {},
        ALL_ACTIONS,
      );

      // Should use LLM path, not fallback
      expect(result.rawResponse).not.toContain("[FALLBACK");
      expect(result.readIntent).toBeDefined();
      expect(result.readIntent!.intent).toBe(AllowedIntent.REPORT_PERFORMANCE);
    });
  });

  // ---------------------------------------------------------------------------
  // Regex fallback patterns (budget exceeded)
  // ---------------------------------------------------------------------------
  describe("regex fallback patterns", () => {
    let routerExhausted: ModelRouter;
    let interpreterFallback: TestableClinicInterpreter;

    beforeEach(() => {
      routerExhausted = new ModelRouter({
        dailyTokenBudget: 10,
        clinicId: "clinic_1",
      });
      routerExhausted.recordUsage(50, 50);

      interpreterFallback = new TestableClinicInterpreter(
        DEFAULT_CONFIG,
        DEFAULT_CONTEXT,
        routerExhausted,
      );
    });

    it("matches 'resume campaign X'", async () => {
      const result = await interpreterFallback.interpret(
        "resume Winter Promo",
        {},
        ALL_ACTIONS,
      );
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.actionType).toBe("ads.campaign.resume");
      expect(result.proposals[0]!.parameters["campaignRef"]).toBe("Winter Promo");
    });

    it("matches 'set budget for X to $Y'", async () => {
      const result = await interpreterFallback.interpret(
        "set budget for Summer Sale to $500",
        {},
        ALL_ACTIONS,
      );
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.actionType).toBe("ads.budget.adjust");
      expect(result.proposals[0]!.parameters["campaignRef"]).toBe("Summer Sale");
      expect(result.proposals[0]!.parameters["newBudget"]).toBe(500);
    });

    it("matches 'how are my campaigns doing'", async () => {
      const result = await interpreterFallback.interpret(
        "how are my campaigns doing",
        {},
        ALL_ACTIONS,
      );
      expect(result.readIntent).toBeDefined();
      expect(result.readIntent!.intent).toBe(AllowedIntent.REPORT_PERFORMANCE);
    });

    it("matches 'more leads'", async () => {
      const result = await interpreterFallback.interpret(
        "more patient leads",
        {},
        ALL_ACTIONS,
      );
      expect(result.readIntent).toBeDefined();
      expect(result.readIntent!.intent).toBe(AllowedIntent.MORE_LEADS);
    });

    it("matches 'reduce cost'", async () => {
      const result = await interpreterFallback.interpret(
        "reduce my ad cost",
        {},
        ALL_ACTIONS,
      );
      expect(result.readIntent).toBeDefined();
      expect(result.readIntent!.intent).toBe(AllowedIntent.REDUCE_COST);
    });

    it("matches 'undo'", async () => {
      const result = await interpreterFallback.interpret(
        "undo",
        {},
        ALL_ACTIONS,
      );
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.actionType).toBe("system.undo");
    });
  });
});
