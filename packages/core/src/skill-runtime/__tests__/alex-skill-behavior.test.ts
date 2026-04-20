import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { SkillExecutorImpl } from "../skill-executor.js";
import { loadSkill } from "../skill-loader.js";
import { createEscalateTool } from "../tools/escalate.js";
import { AnthropicToolCallingAdapter } from "../tool-calling-adapter.js";
import type { SkillTool, SkillExecutionParams } from "../types.js";
import { ok } from "../tool-result.js";
import { VERTICALS } from "./behavior-fixtures/verticals.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../..");

// Universal forbidden patterns for all responses
const UNIVERSAL_FORBIDDEN = [
  /special offer/i,
  /limited time/i,
  /discount.{0,10}(today|now|this week)/i,
  /we have slots on/i,
  /available this week/i,
  /crm-write/i,
  /crm-query/i,
  /escalate tool/i,
  /calendar-book/i,
  /great question/i,
  /i understand your concern/i,
  /thank you for reaching out/i,
];

// Hedge words (for unknown-fact scenarios only)
const HEDGE_WORDS = [/\bprobably\b/i, /\bi think\b/i, /\busually\b/i, /\btypically\b/i];

// Safe fallback pattern (when escalate not called for unknown facts)
const SAFE_FALLBACK =
  /not (certain|sure)|team member|confirm for you|check on that|get.{0,10}(someone|team).{0,10}(help|confirm|check)/i;

function createMockTools(): Map<string, SkillTool> {
  const tools = new Map<string, SkillTool>();
  tools.set("crm-query", {
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get contact",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "read" as const,
        execute: async () => ok({ id: "c1", name: "Test Lead", stage: "new" }),
      },
      "activity.list": {
        description: "List activities",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "read" as const,
        execute: async () => ok({ activities: [] }),
      },
    },
  });
  tools.set("crm-write", {
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "Update stage",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "write" as const,
        execute: async (params: unknown) => ok({ ...(params as object), updated: true }),
      },
      "activity.log": {
        description: "Log activity",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "write" as const,
        execute: async () => ok(),
      },
    },
  });
  tools.set(
    "escalate",
    createEscalateTool({
      assembler: {
        assemble: () => ({
          id: "h_1",
          sessionId: "s",
          organizationId: "o",
          reason: "missing_knowledge" as const,
          status: "pending" as const,
          leadSnapshot: { channel: "whatsapp" },
          qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
          conversationSummary: {
            turnCount: 0,
            keyTopics: [],
            objectionHistory: [],
            sentiment: "neutral",
          },
          slaDeadlineAt: new Date(),
          createdAt: new Date(),
        }),
      },
      handoffStore: { save: async () => {}, getBySessionId: async () => null },
      notifier: { notify: async () => {} },
      sessionId: "test-session",
      orgId: "test-org",
      messages: [],
    }),
  );
  tools.set("calendar-book", {
    id: "calendar-book",
    operations: {
      "slots.query": {
        description: "Query available booking slots",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "read" as const,
        execute: async () => ok({ slots: [] }),
      },
      "booking.create": {
        description: "Create a booking",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "write" as const,
        execute: async () => ok({ bookingId: "b1", confirmed: true }),
      },
    },
  });
  return tools;
}

function countSentences(text: string): number {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return sentences.length;
}

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Alex Skill Behavior (Cross-Vertical)", () => {
  const skill = loadSkill("alex", join(REPO_ROOT, "skills"));
  const adapter = new AnthropicToolCallingAdapter(
    new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  );
  for (const fixture of VERTICALS) {
    describe(`Vertical: ${fixture.businessName}`, () => {
      it("answers known fact from business context", async () => {
        const executor = new SkillExecutorImpl(adapter, createMockTools());
        const params: SkillExecutionParams = {
          skill,
          parameters: {
            BUSINESS_NAME: fixture.businessName,
            OPPORTUNITY_ID: "opp-test-1",
            LEAD_PROFILE: { name: "Sarah", phone: "+6591234567" },
            BUSINESS_FACTS: fixture.businessFacts,
            PERSONA_CONFIG: fixture.personaConfig,
          },
          messages: [{ role: "user", content: fixture.knownFactScenario.message }],
          deploymentId: "test-deployment",
          orgId: "test-org",
          trustScore: 50,
          trustLevel: "guided",
        };

        const result = await executor.execute(params);
        console.warn(`[${fixture.id}] Known fact response:\n${result.response}\n`);

        // Assert response contains expected fact
        expect(
          result.response,
          `Expected response to match pattern: ${fixture.knownFactScenario.expectedFactPattern}`,
        ).toMatch(fixture.knownFactScenario.expectedFactPattern);

        // Assert 1-4 sentences
        const sentenceCount = countSentences(result.response);
        expect(
          sentenceCount,
          `Expected 1-4 sentences, got ${sentenceCount}`,
        ).toBeGreaterThanOrEqual(1);
        expect(sentenceCount, `Expected 1-4 sentences, got ${sentenceCount}`).toBeLessThanOrEqual(
          4,
        );

        // Universal forbidden patterns
        for (const pattern of UNIVERSAL_FORBIDDEN) {
          expect(result.response, `Forbidden pattern: ${pattern}`).not.toMatch(pattern);
        }

        // Vertical-specific forbidden patterns
        for (const pattern of fixture.verticalForbiddenPatterns) {
          expect(result.response, `Vertical forbidden pattern: ${pattern}`).not.toMatch(pattern);
        }
      }, 30_000);

      it("safely handles unknown fact", async () => {
        const executor = new SkillExecutorImpl(adapter, createMockTools());
        const params: SkillExecutionParams = {
          skill,
          parameters: {
            BUSINESS_NAME: fixture.businessName,
            OPPORTUNITY_ID: "opp-test-1",
            LEAD_PROFILE: { name: "Sarah", phone: "+6591234567" },
            BUSINESS_FACTS: fixture.businessFacts,
            PERSONA_CONFIG: fixture.personaConfig,
          },
          messages: [{ role: "user", content: fixture.unknownFactScenario.message }],
          deploymentId: "test-deployment",
          orgId: "test-org",
          trustScore: 50,
          trustLevel: "guided",
        };

        const result = await executor.execute(params);
        console.warn(`[${fixture.id}] Unknown fact response:\n${result.response}\n`);

        // Must not make forbidden claims
        for (const pattern of fixture.unknownFactScenario.forbiddenClaims) {
          expect(result.response, `Forbidden claim: ${pattern}`).not.toMatch(pattern);
        }

        // Must not use hedge words
        for (const pattern of HEDGE_WORDS) {
          expect(result.response, `Hedge word: ${pattern}`).not.toMatch(pattern);
        }

        // Universal forbidden patterns
        for (const pattern of UNIVERSAL_FORBIDDEN) {
          expect(result.response, `Forbidden pattern: ${pattern}`).not.toMatch(pattern);
        }

        // Vertical-specific forbidden patterns
        for (const pattern of fixture.verticalForbiddenPatterns) {
          expect(result.response, `Vertical forbidden pattern: ${pattern}`).not.toMatch(pattern);
        }

        // Either escalated OR used safe fallback
        const escalated = result.toolCalls.some((tc) => tc.toolId === "escalate");
        const usedSafeFallback = SAFE_FALLBACK.test(result.response);
        expect(escalated || usedSafeFallback, "Expected escalation or safe fallback phrase").toBe(
          true,
        );
      }, 30_000);
    });
  }
});
