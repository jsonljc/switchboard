import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMConversationEngine } from "../llm-conversation-engine.js";
import type { LLMConversationContext } from "../llm-conversation-engine.js";

describe("LLMConversationEngine", () => {
  let engine: LLMConversationEngine;

  beforeEach(() => {
    engine = new LLMConversationEngine({
      apiKey: "test-key",
      model: "claude-3-5-haiku-20241022",
    });
  });

  describe("buildSystemPrompt", () => {
    it("includes persona name and business name", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: {
          businessName: "Glow Clinic",
          personaName: "Sarah",
          services: "Botox ($300), Fillers ($500)",
          hours: "Mon-Fri 9am-5pm",
          address: "123 Main St",
          bookingMethod: "Online at example.com/book",
          faqs: "Q: Does it hurt? A: Most patients feel minimal discomfort.",
        },
        conversationHistory: [],
        userMessage: "hi",
      };
      const prompt = engine.buildSystemPrompt(ctx);
      expect(prompt).toContain("Sarah");
      expect(prompt).toContain("Glow Clinic");
      expect(prompt).toContain("Botox");
    });

    it("includes state goal in the prompt", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Assess readiness naturally",
        businessProfile: {
          businessName: "Test Clinic",
          personaName: "Amy",
        },
        conversationHistory: [],
        userMessage: "I want botox",
      };
      const prompt = engine.buildSystemPrompt(ctx);
      expect(prompt).toContain("Assess readiness naturally");
    });

    it("includes lead profile when provided", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: {
          businessName: "Test Clinic",
          personaName: "Amy",
        },
        conversationHistory: [],
        userMessage: "hi",
        leadProfile: {
          serviceInterest: "Teeth Whitening",
          timeline: "immediate",
        },
      };
      const prompt = engine.buildSystemPrompt(ctx);
      expect(prompt).toContain("Teeth Whitening");
    });

    it("says 'new conversation' when no lead profile", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Test", personaName: "Amy" },
        conversationHistory: [],
        userMessage: "hi",
      };
      const prompt = engine.buildSystemPrompt(ctx);
      expect(prompt).toContain("new conversation");
    });
  });

  describe("buildUserPrompt", () => {
    it("includes conversation history and user message", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Test", personaName: "Amy" },
        conversationHistory: [
          { role: "user" as const, text: "hey" },
          { role: "assistant" as const, text: "Hi there! How can I help?" },
        ],
        userMessage: "I want to book something",
      };
      const prompt = engine.buildUserPrompt(ctx);
      expect(prompt).toContain("hey");
      expect(prompt).toContain("Hi there!");
      expect(prompt).toContain("I want to book something");
    });

    it("includes objection context when provided", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Acknowledge concern",
        businessProfile: { businessName: "Test", personaName: "Amy" },
        conversationHistory: [],
        userMessage: "too expensive",
        objectionContext: "Price concern — acknowledge, mention financing options",
      };
      const prompt = engine.buildUserPrompt(ctx);
      expect(prompt).toContain("financing");
    });

    it("caps conversation history at 10 messages", () => {
      const history = Array.from({ length: 15 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `Message ${i}`,
      }));
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Test", personaName: "Amy" },
        conversationHistory: history,
        userMessage: "latest",
      };
      const prompt = engine.buildUserPrompt(ctx);
      // Messages 0-4 should be excluded (only last 10: 5-14)
      expect(prompt).not.toContain("Message 0");
      expect(prompt).not.toContain("Message 4");
      expect(prompt).toContain("Message 5");
      expect(prompt).toContain("Message 14");
    });
  });

  describe("generate", () => {
    it("calls Anthropic API and returns response text", async () => {
      vi.stubGlobal("fetch", async () => ({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Hey! How can I help you today?" }],
          usage: { input_tokens: 100, output_tokens: 15 },
        }),
      }));

      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Glow Clinic", personaName: "Sarah" },
        conversationHistory: [],
        userMessage: "hi",
      };

      const result = await engine.generate(ctx);
      expect(result.text).toBe("Hey! How can I help you today?");
      expect(result.usedLLM).toBe(true);
      expect(result.usage?.promptTokens).toBe(100);
      expect(result.usage?.completionTokens).toBe(15);

      vi.restoreAllMocks();
    });

    it("returns fallback on API failure", async () => {
      vi.stubGlobal("fetch", async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }));

      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Glow Clinic", personaName: "Sarah" },
        conversationHistory: [],
        userMessage: "hi",
      };

      const result = await engine.generate(ctx);
      expect(result.text).toContain("Sarah");
      expect(result.text).toContain("Glow Clinic");
      expect(result.usedLLM).toBe(false);

      vi.restoreAllMocks();
    });

    it("returns fallback when no API key", async () => {
      const noKeyEngine = new LLMConversationEngine({
        apiKey: "",
        model: "claude-3-5-haiku-20241022",
      });

      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Glow Clinic", personaName: "Sarah" },
        conversationHistory: [],
        userMessage: "hi",
      };

      const result = await noKeyEngine.generate(ctx);
      expect(result.usedLLM).toBe(false);
    });

    it("returns fallback when budget exhausted", async () => {
      const mockRouter = {
        shouldUseLLM: vi.fn().mockResolvedValue(false),
        recordUsage: vi.fn(),
        getTodayUsage: vi.fn(),
        getRemainingBudget: vi.fn(),
        getUsageSummary: vi.fn(),
        organizationId: "test",
      };

      const budgetEngine = new LLMConversationEngine(
        { apiKey: "test-key", model: "claude-3-5-haiku-20241022" },
        mockRouter,
      );

      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Glow Clinic", personaName: "Sarah" },
        conversationHistory: [],
        userMessage: "hi",
      };

      const result = await budgetEngine.generate(ctx);
      expect(result.usedLLM).toBe(false);
      expect(mockRouter.shouldUseLLM).toHaveBeenCalled();
    });

    it("records usage via model router when available", async () => {
      const mockRouter = {
        shouldUseLLM: vi.fn().mockResolvedValue(true),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        getTodayUsage: vi.fn(),
        getRemainingBudget: vi.fn(),
        getUsageSummary: vi.fn(),
        organizationId: "test",
      };

      vi.stubGlobal("fetch", async () => ({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Hello!" }],
          usage: { input_tokens: 50, output_tokens: 10 },
        }),
      }));

      const routerEngine = new LLMConversationEngine(
        { apiKey: "test-key", model: "claude-3-5-haiku-20241022" },
        mockRouter,
      );

      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Test", personaName: "Amy" },
        conversationHistory: [],
        userMessage: "hi",
      };

      await routerEngine.generate(ctx, "org-123");
      expect(mockRouter.recordUsage).toHaveBeenCalledWith(50, 10, "org-123");

      vi.restoreAllMocks();
    });
  });
});
