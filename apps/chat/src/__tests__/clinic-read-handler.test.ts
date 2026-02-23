import { describe, it, expect } from "vitest";
import { handleReadIntent } from "../clinic/read-handler.js";
import { AllowedIntent } from "../clinic/types.js";
import type { ReadIntentDescriptor } from "../clinic/types.js";
import type { CartridgeReadAdapter, ReadOperation } from "@switchboard/core";

// ---------------------------------------------------------------------------
// Mock CartridgeReadAdapter
// ---------------------------------------------------------------------------
function createMockReadAdapter(
  queryResult: { data: unknown; traceId: string } = { data: [], traceId: "trace_test" },
  shouldThrow?: Error,
): CartridgeReadAdapter {
  return {
    query: async (_op: ReadOperation) => {
      if (shouldThrow) throw shouldThrow;
      return queryResult;
    },
  } as unknown as CartridgeReadAdapter;
}

const DEFAULT_DEPS = {
  cartridgeId: "ads-spend",
  actorId: "user_1",
  organizationId: null as string | null,
};

const MOCK_CAMPAIGNS = [
  {
    id: "camp_1",
    name: "Summer Sale",
    campaignStatus: "ACTIVE",
    dailyBudget: 5000,
    deliveryStatus: "ACTIVE",
    objective: "LEAD_GENERATION",
  },
  {
    id: "camp_2",
    name: "Winter Promo",
    campaignStatus: "PAUSED",
    dailyBudget: 3000,
    deliveryStatus: "OFF",
    objective: "CONVERSIONS",
  },
];

describe("handleReadIntent", () => {
  // ---------------------------------------------------------------------------
  // REPORT_PERFORMANCE
  // ---------------------------------------------------------------------------
  describe("REPORT_PERFORMANCE", () => {
    it("returns a formatted performance report", async () => {
      const readAdapter = createMockReadAdapter({
        data: MOCK_CAMPAIGNS,
        traceId: "trace_perf",
      });

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.REPORT_PERFORMANCE,
        slots: {},
        confidence: 0.95,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(result.traceId).toBe("trace_perf");
      expect(result.text).toContain("Campaign Performance Report");
      expect(result.text).toContain("Summer Sale");
      expect(result.text).toContain("Winter Promo");
      expect(result.text).toContain("1 active");
      expect(result.text).toContain("1 paused");
    });

    it("returns 'no campaigns' when data is empty", async () => {
      const readAdapter = createMockReadAdapter({
        data: [],
        traceId: "trace_empty",
      });

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.REPORT_PERFORMANCE,
        slots: {},
        confidence: 0.9,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(result.text).toContain("No campaigns found");
    });

    it("passes campaignRef slot as query parameter", async () => {
      let capturedOp: ReadOperation | null = null;
      const readAdapter = {
        query: async (op: ReadOperation) => {
          capturedOp = op;
          return { data: MOCK_CAMPAIGNS, traceId: "trace_ref" };
        },
      } as unknown as CartridgeReadAdapter;

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.REPORT_PERFORMANCE,
        slots: { campaignRef: "Summer Sale" },
        confidence: 0.9,
      };

      await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(capturedOp).not.toBeNull();
      expect(capturedOp!.parameters).toEqual({
        query: "Summer Sale",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // CHECK_STATUS
  // ---------------------------------------------------------------------------
  describe("CHECK_STATUS", () => {
    it("returns campaign status card when campaignRef is specified", async () => {
      const readAdapter = createMockReadAdapter({
        data: [MOCK_CAMPAIGNS[0]],
        traceId: "trace_status",
      });

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.CHECK_STATUS,
        slots: { campaignRef: "Summer Sale" },
        confidence: 0.9,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(result.traceId).toBe("trace_status");
      expect(result.text).toContain("Campaign: Summer Sale");
      expect(result.text).toContain("Status: Active");
      expect(result.text).toContain("$50.00");
    });

    it("returns performance report when no campaignRef", async () => {
      const readAdapter = createMockReadAdapter({
        data: MOCK_CAMPAIGNS,
        traceId: "trace_all",
      });

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.CHECK_STATUS,
        slots: {},
        confidence: 0.85,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      // Without campaignRef, falls back to performance report
      expect(result.text).toContain("Campaign Performance Report");
    });

    it("returns not-found message for empty results", async () => {
      const readAdapter = createMockReadAdapter({
        data: [],
        traceId: "trace_notfound",
      });

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.CHECK_STATUS,
        slots: { campaignRef: "Nonexistent" },
        confidence: 0.9,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(result.text).toContain("Campaign not found");
    });
  });

  // ---------------------------------------------------------------------------
  // MORE_LEADS
  // ---------------------------------------------------------------------------
  describe("MORE_LEADS", () => {
    it("returns recommendations for more leads", async () => {
      const readAdapter = createMockReadAdapter({
        data: MOCK_CAMPAIGNS,
        traceId: "trace_leads",
      });

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.MORE_LEADS,
        slots: {},
        confidence: 0.85,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(result.traceId).toBe("trace_leads");
      expect(result.text).toContain("Recommendations for More Leads");
      expect(result.text).toContain("Increase budget");
    });

    it("returns 'no campaigns' when none exist", async () => {
      const readAdapter = createMockReadAdapter({
        data: [],
        traceId: "trace_empty",
      });

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.MORE_LEADS,
        slots: {},
        confidence: 0.85,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(result.text).toContain("No campaigns found");
    });
  });

  // ---------------------------------------------------------------------------
  // REDUCE_COST
  // ---------------------------------------------------------------------------
  describe("REDUCE_COST", () => {
    it("returns recommendations to reduce cost", async () => {
      const readAdapter = createMockReadAdapter({
        data: MOCK_CAMPAIGNS,
        traceId: "trace_cost",
      });

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.REDUCE_COST,
        slots: {},
        confidence: 0.85,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(result.traceId).toBe("trace_cost");
      expect(result.text).toContain("Recommendations to Reduce Cost");
      expect(result.text).toContain("Reduce budget");
    });
  });

  // ---------------------------------------------------------------------------
  // Default / unknown intent
  // ---------------------------------------------------------------------------
  describe("unknown intent in read handler", () => {
    it("returns help text for unrecognized intent", async () => {
      const readAdapter = createMockReadAdapter();

      const intent: ReadIntentDescriptor = {
        intent: "some_future_intent" as AllowedIntent,
        slots: {},
        confidence: 0.5,
      };

      const result = await handleReadIntent(intent, {
        readAdapter,
        ...DEFAULT_DEPS,
      });

      expect(result.text).toContain("don't know how to handle");
      expect(result.traceId).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe("error handling", () => {
    it("propagates readAdapter.query errors", async () => {
      const readAdapter = createMockReadAdapter(
        { data: [], traceId: "" },
        new Error("API connection failed"),
      );

      const intent: ReadIntentDescriptor = {
        intent: AllowedIntent.REPORT_PERFORMANCE,
        slots: {},
        confidence: 0.9,
      };

      await expect(
        handleReadIntent(intent, { readAdapter, ...DEFAULT_DEPS }),
      ).rejects.toThrow("API connection failed");
    });
  });
});
