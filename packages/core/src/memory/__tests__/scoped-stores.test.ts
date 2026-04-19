import { describe, it, expect } from "vitest";
import type {
  CustomerScopedMemoryAccess,
  OwnerMemoryAccess,
  AggregateScopedMemoryAccess,
} from "../scoped-stores.js";

describe("Scoped Store Interfaces", () => {
  it("CustomerScopedMemoryAccess has read-only methods", () => {
    const store: CustomerScopedMemoryAccess = {
      getBusinessKnowledge: async () => [],
      getHighConfidenceFacts: async () => [],
      getContactSummaries: async () => [],
    };
    expect(store.getBusinessKnowledge).toBeDefined();
    expect(store.getHighConfidenceFacts).toBeDefined();
    expect(store.getContactSummaries).toBeDefined();
    // Should NOT have listAllMemories, delete, correct, etc.
    expect((store as unknown as Record<string, unknown>).listAllMemories).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).deleteMemory).toBeUndefined();
  });

  it("OwnerMemoryAccess has full CRUD", () => {
    const store: OwnerMemoryAccess = {
      listAllMemories: async () => [],
      correctMemory: async () => {},
      deleteMemory: async () => {},
      listDraftFAQs: async () => [],
      approveDraftFAQ: async () => {},
      rejectDraftFAQ: async () => {},
      listActivityLog: async () => [],
      listAllSummaries: async () => [],
    };
    expect(store.listAllMemories).toBeDefined();
    expect(store.correctMemory).toBeDefined();
    expect(store.approveDraftFAQ).toBeDefined();
  });

  it("AggregateScopedMemoryAccess has write + aggregate-only methods", () => {
    const store: AggregateScopedMemoryAccess = {
      upsertFact: async () => ({
        id: "1",
        organizationId: "",
        deploymentId: "",
        category: "",
        content: "",
        confidence: 0.5,
        sourceCount: 1,
      }),
      writeSummary: async () => {},
      writeActivityLog: async () => {},
      findFactsByCategory: async () => [],
      promoteDraftFAQs: async () => 0,
      decayStale: async () => 0,
    };
    expect(store.upsertFact).toBeDefined();
    expect(store.writeSummary).toBeDefined();
    // Should NOT have listAllMemories or getContactSummaries
    expect((store as unknown as Record<string, unknown>).listAllMemories).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).getContactSummaries).toBeUndefined();
  });
});
