import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConversationCompoundingService } from "../compounding-service.js";
import type { BookingAttributionStore } from "../booking-attribution.js";
import {
  createInMemoryMetrics,
  setMetrics,
  type SwitchboardMetrics,
} from "../../telemetry/metrics.js";
import {
  baseEvent,
  createMetricsSpy,
  createMockDeps,
  primeSummarizeAndExtract,
} from "./compounding-service-fixtures.js";

let metricsSpy: SwitchboardMetrics;

/**
 * Returns embedding pairs whose cosine similarity equals the target value.
 * Used to assert merge/no-merge boundaries at OUTCOME_PATTERN_MERGE_THRESHOLD.
 */
function embedAtCosine(target: number): { incoming: number[]; existing: number[] } {
  // [1, 0, 0] vs [target, sqrt(1 - target^2), 0] → cosine = target
  const orthogonal = Math.sqrt(1 - target * target);
  return { incoming: [1, 0, 0], existing: [target, orthogonal, 0] };
}

describe("ConversationCompoundingService — two-stage merge at 0.84 (PR-3.2b)", () => {
  beforeEach(() => {
    metricsSpy = createMetricsSpy();
    setMetrics(metricsSpy);
  });

  afterEach(() => {
    setMetrics(createInMemoryMetrics());
    vi.restoreAllMocks();
  });

  it("merges two patterns with the same canonicalKey when cosine >= 0.84", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn().mockResolvedValue(undefined) };
    deps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([
      {
        id: "mem-1",
        content: "Customers ask about downtime before booking",
        sourceCount: 2,
        confidence: 0.61,
      },
    ]);
    const { incoming, existing } = embedAtCosine(0.86);
    let firstEmbed = true;
    deps.embeddingAdapter.embed.mockImplementation(async () => {
      if (firstEmbed) {
        firstEmbed = false;
        return incoming;
      }
      return existing;
    });
    deps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "mem-1",
      sourceCount: 3,
    });
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [
          {
            text: "People want to know recovery time",
            canonicalKey: "objection:downtime_work",
          },
        ],
      },
    );

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "mem-1",
      expect.any(Number),
    );
    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
    expect(evidenceStore.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentMemoryId: "mem-1", bookingId: "bk-1" }),
    );
  });

  it("creates a new row when same-bucket cosine is below 0.84", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn().mockResolvedValue(undefined) };
    deps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([
      {
        id: "mem-1",
        content: "Can I wear makeup tomorrow?",
        sourceCount: 2,
        confidence: 0.61,
      },
    ]);
    const { incoming, existing } = embedAtCosine(0.81);
    let firstEmbed = true;
    deps.embeddingAdapter.embed.mockImplementation(async () => {
      if (firstEmbed) {
        firstEmbed = false;
        return incoming;
      }
      return existing;
    });
    deps.deploymentMemoryStore.create.mockResolvedValue({ id: "mem-2" });
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [
          {
            text: "When can I work out again?",
            canonicalKey: "objection:aftercare_restrictions",
          },
        ],
      },
    );

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    // Distinguishable sub-intents in the same bucket land as separate rows.
    expect(deps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "When can I work out again?",
        canonicalKey: "objection:aftercare_restrictions",
      }),
    );
    expect(deps.deploymentMemoryStore.incrementConfidence).not.toHaveBeenCalled();
  });

  it("creates a new row when canonicalKey is new even if a >0.92 match exists in another bucket, and flags the collision", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn().mockResolvedValue(undefined) };
    // Stage 1: no match in incoming canonical bucket
    deps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([]);
    // Stage 0 broad scan: a >0.92 match exists under a different canonicalKey
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([
      {
        id: "mem-other",
        content: "Different topic but cosine-close text",
        canonicalKey: "scheduling:availability",
        sourceCount: 3,
        confidence: 0.7,
      },
    ]);
    const { incoming, existing } = embedAtCosine(0.95);
    let firstEmbed = true;
    deps.embeddingAdapter.embed.mockImplementation(async () => {
      if (firstEmbed) {
        firstEmbed = false;
        return incoming;
      }
      return existing;
    });
    deps.deploymentMemoryStore.create.mockResolvedValue({ id: "mem-new" });
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [{ text: "Different intent", canonicalKey: "objection:pain" }],
      },
    );

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.create).toHaveBeenCalled();
    expect(metricsSpy.outcomePatternsCrossKeyCollision.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
      currentKey: "objection:pain",
      collidingKey: "scheduling:availability",
    });
  });

  it("does NOT auto-merge across canonical keys even when stage-0 cosine is high", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn().mockResolvedValue(undefined) };
    deps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([]);
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([
      {
        id: "mem-other",
        content: "Different topic but cosine-close text",
        canonicalKey: "scheduling:availability",
        sourceCount: 3,
        confidence: 0.7,
      },
    ]);
    const { incoming, existing } = embedAtCosine(0.95);
    let firstEmbed = true;
    deps.embeddingAdapter.embed.mockImplementation(async () => {
      if (firstEmbed) {
        firstEmbed = false;
        return incoming;
      }
      return existing;
    });
    deps.deploymentMemoryStore.create.mockResolvedValue({ id: "mem-new" });
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [{ text: "Different intent", canonicalKey: "objection:pain" }],
      },
    );

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.incrementConfidence).not.toHaveBeenCalled();
    expect(metricsSpy.outcomePatternsMerged.inc).not.toHaveBeenCalled();
  });

  it("picks the highest-similarity match in the canonical bucket when multiple cross the threshold", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn().mockResolvedValue(undefined) };
    deps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([
      { id: "mem-lower", content: "lower", sourceCount: 2, confidence: 0.6 },
      { id: "mem-higher", content: "higher", sourceCount: 5, confidence: 0.75 },
    ]);
    // First embed = incoming; subsequent embeds alternate per entry. The lower
    // match returns 0.86 cosine; the higher match returns 0.92.
    const incomingVec = [1, 0, 0];
    const lowerMatch = embedAtCosine(0.86).existing;
    const higherMatch = embedAtCosine(0.92).existing;
    let call = 0;
    deps.embeddingAdapter.embed.mockImplementation(async () => {
      const idx = call++;
      if (idx === 0) return incomingVec;
      if (idx === 1) return lowerMatch;
      return higherMatch;
    });
    deps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "mem-higher",
      sourceCount: 6,
    });
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [{ text: "incoming pattern", canonicalKey: "objection:downtime_work" }],
      },
    );

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "mem-higher",
      expect.any(Number),
    );
  });
});
