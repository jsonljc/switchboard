import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConversationCompoundingService } from "../compounding-service.js";
import type { BookingAttributionStore } from "../booking-attribution.js";
import { setMetrics, type SwitchboardMetrics } from "../../telemetry/metrics.js";
import {
  baseEvent,
  createMetricsSpy,
  createMockDeps,
  primeSummarizeAndExtract,
} from "./compounding-service-fixtures.js";

let metricsSpy: SwitchboardMetrics;

describe("ConversationCompoundingService — canonical-key validation (PR-3.2a)", () => {
  beforeEach(() => {
    metricsSpy = createMetricsSpy();
    setMetrics(metricsSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists canonicalKey on the new pattern row and writes an evidence edge", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn().mockResolvedValue(undefined) };
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [
          { text: "Customers ask about downtime", canonicalKey: "objection:downtime_work" },
        ],
      },
    );
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
    deps.deploymentMemoryStore.findByCategoryAndCanonicalKey.mockResolvedValue([]);
    deps.deploymentMemoryStore.create.mockResolvedValue({ id: "mem-1" });

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "pattern",
        content: "Customers ask about downtime",
        canonicalKey: "objection:downtime_work",
      }),
    );
    expect(evidenceStore.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentMemoryId: "mem-1",
        bookingId: "bk-1",
        attributionTier: "strong",
      }),
    );
  });

  it("drops patterns whose canonicalKey is structurally malformed", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn() };
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [{ text: "bad slug shape", canonicalKey: "Objection Downtime" }],
      },
    );

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
    expect(evidenceStore.recordEvidence).not.toHaveBeenCalled();
    expect(metricsSpy.outcomePatternsRejected.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
      reason: "invalid_canonical_key",
    });
  });

  it("drops patterns whose canonicalKey is not in the deployment's enum", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn() };
    // Both slugs match the structural regex but are not in MEDSPA_CANONICAL_KEYS,
    // so both must be rejected under reason="unknown_canonical_key".
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [
          { text: "Customer wants warlock-blessed treatment", canonicalKey: "objection:warlock" },
          { text: "Different topic", canonicalKey: "objection:made_up_key" },
        ],
      },
    );

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
    expect(metricsSpy.outcomePatternsRejected.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
      reason: "unknown_canonical_key",
    });
    expect(metricsSpy.outcomePatternsRejected.inc).toHaveBeenCalledTimes(2);
  });

  it("rejects the literal 'unknown' canonicalKey under invalid_canonical_key (no colon)", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const evidenceStore = { recordEvidence: vi.fn() };
    primeSummarizeAndExtract(
      deps,
      { summary: "Booked", outcome: "booked" },
      {
        patterns: [{ text: "doesn't fit any slug", canonicalKey: "unknown" }],
      },
    );

    const service = new ConversationCompoundingService({ ...deps, bookingStore, evidenceStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
    expect(metricsSpy.outcomePatternsRejected.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
      reason: "invalid_canonical_key",
    });
  });
});
