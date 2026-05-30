import { vi } from "vitest";
import type { ConversationEndEvent } from "@switchboard/core";
import { createInMemoryMetrics, type SwitchboardMetrics } from "../../telemetry/metrics.js";

export function createMetricsSpy(): SwitchboardMetrics {
  const base = createInMemoryMetrics();
  vi.spyOn(base.outcomePatternsExtracted, "inc");
  vi.spyOn(base.outcomePatternsMerged, "inc");
  vi.spyOn(base.outcomePatternsCreated, "inc");
  vi.spyOn(base.outcomePatternsSurfaced, "inc");
  vi.spyOn(base.outcomePatternsRejected, "inc");
  vi.spyOn(base.outcomePatternsCrossKeyCollision, "inc");
  vi.spyOn(base.outcomePatternConfidence, "observe");
  return base;
}

export function createMockDeps() {
  return {
    llmClient: {
      complete: vi.fn(),
    },
    embeddingAdapter: {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0)]),
      dimensions: 1024,
      available: true,
    },
    interactionSummaryStore: {
      create: vi.fn().mockResolvedValue({ id: "sum-1" }),
    },
    deploymentMemoryStore: {
      findByCategory: vi.fn().mockResolvedValue([]),
      findByCategoryAndCanonicalKey: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "mem-1" }),
      incrementConfidence: vi.fn().mockResolvedValue({ id: "mem-1", sourceCount: 2 }),
      countByDeployment: vi.fn().mockResolvedValue(0),
      findEvictionCandidate: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

export const baseEvent: ConversationEndEvent = {
  deploymentId: "dep-1",
  organizationId: "org-1",
  contactId: null,
  channelType: "telegram",
  sessionId: "session-1",
  messages: [
    { role: "user", content: "What services do you offer?" },
    { role: "assistant", content: "We offer teeth whitening and cleaning." },
    { role: "user", content: "How much is teeth whitening?" },
    { role: "assistant", content: "Teeth whitening starts at $299." },
  ],
  duration: 120,
  messageCount: 4,
  endReason: "inactivity",
  endedAt: new Date(),
};

export function createEvent(): ConversationEndEvent {
  return { ...baseEvent };
}

export function primeSummarizeAndExtract(
  deps: ReturnType<typeof createMockDeps>,
  summarization: { summary: string; outcome: string },
  extraction: {
    facts?: Array<{ fact: string; confidence: number; category: string }>;
    questions?: string[];
    patterns?: Array<{ text: string; canonicalKey: string }>;
  },
): void {
  deps.llmClient.complete
    .mockResolvedValueOnce(JSON.stringify(summarization))
    .mockResolvedValueOnce(
      JSON.stringify({
        facts: extraction.facts ?? [],
        questions: extraction.questions ?? [],
        patterns: extraction.patterns ?? [],
      }),
    );
}

export function primeFaqExtractionLlm(
  deps: ReturnType<typeof createMockDeps>,
  question: string,
): void {
  deps.llmClient.complete
    .mockResolvedValueOnce(
      JSON.stringify({
        summary: "Customer asked an FAQ.",
        outcome: "info_request",
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        facts: [],
        questions: [question],
      }),
    );
}
