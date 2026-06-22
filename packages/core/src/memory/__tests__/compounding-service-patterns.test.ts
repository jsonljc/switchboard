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

describe("ConversationCompoundingService — outcome-pattern writes (PR-3.1 booking gating)", () => {
  beforeEach(() => {
    metricsSpy = createMetricsSpy();
    setMetrics(metricsSpy);
  });

  afterEach(() => {
    setMetrics(createInMemoryMetrics());
    vi.restoreAllMocks();
  });

  it("writes pattern-category memories when summarization outcome is booked", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-1" }]),
    };
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Customer booked laser treatment", outcome: "booked" },
      {
        patterns: [
          {
            text: "Customers ask about downtime before booking laser treatment",
            canonicalKey: "objection:downtime_work",
          },
        ],
      },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, contactId: "contact-1" });

    expect(localDeps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "pattern",
        content: "Customers ask about downtime before booking laser treatment",
        canonicalKey: "objection:downtime_work",
      }),
    );
  });

  it("tags the pattern create with source: pattern-merge", async () => {
    // Provenance: every new pattern written by the compounding service must carry
    // source="pattern-merge" so downstream consumers can attribute the write.
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-1" }]),
    };
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
    localDeps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([]);
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Customer booked", outcome: "booked" },
      {
        patterns: [
          {
            text: "Customers ask about downtime before booking",
            canonicalKey: "objection:downtime_work",
          },
        ],
      },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, contactId: "contact-1" });

    const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(1);
    expect(patternCreates[0]![0]).toMatchObject({ source: "pattern-merge" });
  });

  it("does not write pattern-category memories for non-booked outcomes", async () => {
    for (const outcome of ["lost", "qualified", "info_request", "escalated"] as const) {
      const localDeps = createMockDeps();
      localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
      primeSummarizeAndExtract(
        localDeps,
        { summary: `Conversation ended ${outcome}`, outcome },
        {
          patterns: [
            {
              text: "should not surface because outcome is not booked",
              canonicalKey: "objection:downtime_work",
            },
          ],
        },
      );
      localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

      const localService = new ConversationCompoundingService(localDeps);
      await localService.processConversationEnd(baseEvent);

      const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
        (c) => c[0].category === "pattern",
      );
      expect(patternCreates).toHaveLength(0);
    }
  });

  it("increments confidence on a near-duplicate pattern instead of creating a duplicate", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-dup" }]),
    };
    // PR-3.2b two-stage merge: the canonical-bucket lookup is the merge path,
    // not the broad findByCategory scan (that scan now only flags cross-key
    // collisions). Stub the bucket lookup with the existing row.
    localDeps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([
      {
        id: "p-existing",
        content: "Customers ask about downtime before booking laser treatment",
        sourceCount: 2,
        confidence: 0.6,
      },
    ]);
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
    localDeps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "p-existing",
      sourceCount: 3,
    });
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Booked again", outcome: "booked" },
      {
        patterns: [
          {
            text: "Customers ask about downtime before booking laser treatment",
            canonicalKey: "objection:downtime_work",
          },
        ],
      },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, contactId: "contact-1" });

    expect(localDeps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "p-existing",
      expect.any(Number),
    );
    const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(0);
  });

  it("records evidence against the existing row when create collides on same content under a different canonical key (F13)", async () => {
    // The DeploymentMemory unique is on CONTENT (org, deployment, category,
    // content), NOT canonicalKey. A row with the SAME content already exists
    // under a DIFFERENT canonicalKey, so the new-key create raises P2002. The
    // bug: that P2002 used to propagate and get swallowed at the
    // processOutcomePatterns boundary, dropping the booking-attributed
    // evidence. The fix: re-resolve the existing row and credit it instead.
    const localDeps = createMockDeps();
    const evidenceStore = { recordEvidence: vi.fn().mockResolvedValue(undefined) };
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-collide", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const collidingContent = "Customers ask about downtime before booking laser treatment";
    // Stage-1 same-key bucket is empty (the existing row lives under a
    // different key), so the merge path is skipped and the create is attempted.
    localDeps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([]);
    // The broad scan + re-resolve both read findByCategory: the existing row
    // has identical content but a DIFFERENT canonicalKey.
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([
      {
        id: "p-existing-other-key",
        content: collidingContent,
        sourceCount: 2,
        confidence: 0.6,
        canonicalKey: "objection:price_value",
      },
    ]);
    // Simulate the DB unique on content: the create with the new key throws
    // P2002 because a row with this content already exists.
    localDeps.deploymentMemoryStore.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    localDeps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "p-existing-other-key",
      sourceCount: 3,
    });
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Booked despite a cross-key content collision", outcome: "booked" },
      {
        patterns: [{ text: collidingContent, canonicalKey: "objection:downtime_work" }],
      },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const localService = new ConversationCompoundingService({
      ...localDeps,
      bookingStore,
      evidenceStore,
    });
    // The whole call must not swallow-and-drop the evidence.
    await localService.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    // Evidence is credited to the EXISTING row (the check-leg id is reused).
    expect(localDeps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "p-existing-other-key",
      expect.any(Number),
    );
    // Evidence binds to the existing row's id, not a phantom new id.
    expect(evidenceStore.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentMemoryId: "p-existing-other-key",
        bookingId: "bk-collide",
      }),
    );
  });

  it("does NOT write patterns when summarization.outcome is booked but no Booking exists", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([]),
    };
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Customer claimed to book", outcome: "booked" },
      {
        patterns: [
          {
            text: "fake-pattern from hallucinated booking",
            canonicalKey: "objection:downtime_work",
          },
        ],
      },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd(baseEvent);

    const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(0);
    expect(localDeps.deploymentMemoryStore.incrementConfidence).not.toHaveBeenCalled();
  });

  it("writes patterns under tier 'strong' when workTraceId matches a Booking", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [
          {
            text: "Customers ask about downtime before booking laser treatment",
            canonicalKey: "objection:downtime_work",
          },
        ],
      },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(localDeps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ category: "pattern" }),
    );
    expect(metricsSpy.outcomePatternsExtracted.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
      attributionTier: "strong",
    });
  });

  it("writes patterns under tier 'fallback' when only the window matches", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-2" }]),
    };
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [
          {
            text: "Customers prefer morning appointments",
            canonicalKey: "scheduling:availability",
          },
        ],
      },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, contactId: "contact-1" });

    expect(metricsSpy.outcomePatternsExtracted.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
      attributionTier: "fallback",
    });
    expect(metricsSpy.outcomePatternsCreated.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
    });
  });

  it("does not write patterns for non-booked outcomes even when a recent Booking exists", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-orphan" }]),
    };
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Customer asked about pricing", outcome: "qualified" },
      {
        patterns: [{ text: "should not surface", canonicalKey: "objection:price_value" }],
      },
    );

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd(baseEvent);

    const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(0);
  });

  const MAX_PATTERNS_PER_CONVERSATION = 5;
  const MAX_PATTERN_LENGTH = 500;

  it("ignores extraction.patterns when it is not an array", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "x", outcome: "booked" }))
      .mockResolvedValueOnce(
        JSON.stringify({ facts: [], questions: [], patterns: "not an array" }),
      );
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const service = new ConversationCompoundingService({ ...deps, bookingStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("filters malformed entries out of extraction.patterns", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "x", outcome: "booked" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [],
          questions: [],
          patterns: [
            { text: "valid pattern", canonicalKey: "objection:pain" },
            42,
            null,
            { evil: "object" }, // missing text + canonicalKey
            { text: "missing key only" },
            { canonicalKey: "objection:pain" }, // missing text
            { text: "another valid pattern", canonicalKey: "objection:price_value" },
          ],
        }),
      );
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const service = new ConversationCompoundingService({ ...deps, bookingStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    const patternCreates = deps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(2);
    expect(patternCreates.map((c) => c[0].content)).toEqual([
      "valid pattern",
      "another valid pattern",
    ]);
  });

  it("caps extraction.patterns at MAX_PATTERNS_PER_CONVERSATION entries", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const twentyPatterns = Array.from({ length: 20 }, (_, i) => ({
      text: `pattern ${i}`,
      canonicalKey: "objection:pain",
    }));
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "x", outcome: "booked" }))
      .mockResolvedValueOnce(
        JSON.stringify({ facts: [], questions: [], patterns: twentyPatterns }),
      );
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const service = new ConversationCompoundingService({ ...deps, bookingStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    const patternCreates = deps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(MAX_PATTERNS_PER_CONVERSATION);
  });

  it("truncates pattern strings longer than MAX_PATTERN_LENGTH", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const huge = "x".repeat(5000);
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "x", outcome: "booked" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [],
          questions: [],
          patterns: [{ text: huge, canonicalKey: "objection:pain" }],
        }),
      );
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const service = new ConversationCompoundingService({ ...deps, bookingStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    const patternCreates = deps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(1);
    expect((patternCreates[0]![0].content as string).length).toBe(MAX_PATTERN_LENGTH);
  });
});
