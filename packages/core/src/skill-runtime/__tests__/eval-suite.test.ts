import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { SkillExecutorImpl } from "../skill-executor.js";
import { loadSkill } from "../skill-loader.js";
import { createEscalateTool } from "../tools/escalate.js";
import type { ToolCallingAdapter } from "../tool-calling-adapter.js";
import type { SkillTool, SkillExecutionParams } from "../types.js";
import { SkillParameterError, SkillExecutionBudgetError } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "eval-fixtures");
const REPO_ROOT = join(__dirname, "../../../../..");

interface MockContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface MockResponse {
  content: MockContentBlock[];
  stop_reason: string;
}

interface EvalFixture {
  name: string;
  parameters: Record<string, unknown>;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  mockResponses: MockResponse[];
  assertions: Array<
    | { type: "tool_called"; toolName: string }
    | { type: "tool_not_called"; toolName: string }
    | { type: "response_contains"; substring: string }
    | { type: "response_not_contains"; substring: string }
    | { type: "error_thrown"; errorType: string }
  >;
  trustLevel?: "supervised" | "guided" | "autonomous";
  expectError?: boolean;
}

function loadFixture(name: string): EvalFixture {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8");
  return JSON.parse(raw) as EvalFixture;
}

function createMockAdapter(fixture: EvalFixture): ToolCallingAdapter {
  let callIndex = 0;
  return {
    chatWithTools: async (_params: {
      system: string;
      messages: Array<Anthropic.MessageParam>;
      tools: Array<Anthropic.Tool>;
      maxTokens?: number;
    }) => {
      const resp = fixture.mockResponses[callIndex];
      if (!resp) {
        return {
          content: [{ type: "text" as const, text: "Mock exhausted" } as Anthropic.TextBlock],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      callIndex++;
      return {
        content: resp.content.map((block) => {
          if (block.type === "tool_use") {
            return {
              type: "tool_use" as const,
              id: block.id ?? "mock-id",
              name: block.name ?? "unknown",
              input: block.input ?? {},
              caller: { type: "direct" as const },
            } as Anthropic.ToolUseBlock;
          }
          return { type: "text" as const, text: block.text ?? "" } as Anthropic.TextBlock;
        }),
        stopReason: resp.stop_reason as "end_turn" | "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  };
}

function createMockTools(): Map<string, SkillTool> {
  const tools = new Map<string, SkillTool>();
  tools.set("crm-query", {
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get contact",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "read" as const,
        execute: async () => ({ id: "c1", name: "Test Lead", stage: "new" }),
      },
      "activity.list": {
        description: "List activities",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "read" as const,
        execute: async () => [],
      },
    },
  });
  tools.set("crm-write", {
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "Update stage",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "internal_write" as const,
        execute: async (params: unknown) => ({ ...(params as object), updated: true }),
      },
      "activity.log": {
        description: "Log activity",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "internal_write" as const,
        execute: async () => undefined,
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
      sessionContext: {
        sessionId: "s",
        organizationId: "o",
        leadSnapshot: { channel: "whatsapp" },
        qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
        messages: [],
      },
    }),
  );
  tools.set("web-scanner", {
    id: "web-scanner",
    operations: {
      "validate-url": {
        description: "Validate URL",
        inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        governanceTier: "read" as const,
        execute: async (params: unknown) => {
          const { url } = params as { url: string };
          try {
            new URL(url);
            return { valid: true, validatedUrl: url, error: null };
          } catch {
            return { valid: false, validatedUrl: null, error: "Invalid URL format" };
          }
        },
      },
      "fetch-pages": {
        description: "Fetch pages",
        inputSchema: {
          type: "object",
          properties: { baseUrl: { type: "string" } },
          required: ["baseUrl"],
        },
        governanceTier: "read" as const,
        execute: async () => ({
          pages: [
            { path: "/", text: "Homepage content", status: "ok" },
            { path: "/about", text: "About us content", status: "ok" },
          ],
          homepageHtml: "<html><head></head><body>Homepage</body></html>",
          fetchedCount: 2,
          failedPaths: [],
        }),
      },
      "detect-platform": {
        description: "Detect platform",
        inputSchema: {
          type: "object",
          properties: { html: { type: "string" } },
          required: ["html"],
        },
        governanceTier: "read" as const,
        execute: async () => ({ platform: null, confidence: "none" }),
      },
      "extract-business-info": {
        description: "Extract business info",
        inputSchema: {
          type: "object",
          properties: { html: { type: "string" } },
          required: ["html"],
        },
        governanceTier: "read" as const,
        execute: async () => ({ structuredData: [], openGraph: {}, meta: {} }),
      },
    },
  });
  tools.set("ads-analytics", {
    id: "ads-analytics",
    operations: {
      diagnose: {
        description: "Diagnose performance issues",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "read" as const,
        execute: async () => ({ diagnoses: [] }),
      },
      "compare-periods": {
        description: "Compare current vs previous period metrics",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "read" as const,
        execute: async () => ({ deltas: [] }),
      },
      "analyze-funnel": {
        description: "Analyze conversion funnel",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "read" as const,
        execute: async () => ({
          stages: [],
          leakagePoint: "Clicks",
          leakageMagnitude: 0,
        }),
      },
      "check-learning-phase": {
        description: "Check if campaign is in learning phase",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "read" as const,
        execute: async () => ({
          campaignId: "c1",
          inLearning: false,
          daysSinceChange: 14,
          eventsAccumulated: 100,
          eventsRequired: 50,
          estimatedExitDate: null,
        }),
      },
    },
  });
  return tools;
}

async function runFixture(fixtureName: string): Promise<void> {
  const fixture = loadFixture(fixtureName);
  let skillName = "sales-pipeline";
  if (fixtureName.startsWith("wp-")) {
    skillName = "website-profiler";
  } else if (fixtureName.startsWith("ao-")) {
    skillName = "ad-optimizer";
  }
  const skill = loadSkill(skillName, join(REPO_ROOT, "skills"));
  const adapter = createMockAdapter(fixture);
  const tools = createMockTools();
  const executor = new SkillExecutorImpl(adapter, tools);

  const params: SkillExecutionParams = {
    skill,
    parameters: fixture.parameters,
    messages: fixture.messages,
    deploymentId: "test-deployment",
    orgId: "test-org",
    trustScore: 50,
    trustLevel: fixture.trustLevel ?? "guided",
  };

  if (fixture.expectError) {
    const errorAssertion = fixture.assertions.find((a) => a.type === "error_thrown");
    if (errorAssertion && errorAssertion.type === "error_thrown") {
      const ErrorClass =
        errorAssertion.errorType === "SkillParameterError"
          ? SkillParameterError
          : SkillExecutionBudgetError;
      await expect(executor.execute(params)).rejects.toThrow(ErrorClass);
    }
    return;
  }

  const result = await executor.execute(params);

  for (const assertion of fixture.assertions) {
    switch (assertion.type) {
      case "tool_called": {
        const found = result.toolCalls.some(
          (tc) => `${tc.toolId}.${tc.operation}` === assertion.toolName,
        );
        expect(found, `Expected tool call: ${assertion.toolName}`).toBe(true);
        break;
      }
      case "tool_not_called": {
        const found = result.toolCalls.some(
          (tc) => `${tc.toolId}.${tc.operation}` === assertion.toolName,
        );
        expect(found, `Expected no call to: ${assertion.toolName}`).toBe(false);
        break;
      }
      case "response_contains":
        expect(result.response).toContain(assertion.substring);
        break;
      case "response_not_contains":
        expect(result.response).not.toContain(assertion.substring);
        break;
    }
  }
}

// Load all fixtures dynamically
const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""))
  .sort();

describe("Behavioral Parity Eval Suite", () => {
  for (const fixtureName of fixtureFiles) {
    it(`passes: ${fixtureName}`, async () => {
      await runFixture(fixtureName);
    });
  }
});
