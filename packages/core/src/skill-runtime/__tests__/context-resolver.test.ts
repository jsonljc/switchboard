import { describe, it, expect, vi } from "vitest";
import { ContextResolverImpl } from "../context-resolver.js";
import type { KnowledgeKind, BusinessFacts } from "@switchboard/schemas";
import { ContextResolutionError } from "../types.js";

function mockStore(
  entries: Array<{
    kind: KnowledgeKind;
    scope: string;
    content: string;
    priority: number;
    updatedAt: Date;
  }>,
) {
  return {
    findActive: vi.fn().mockResolvedValue(
      entries.map((e, i) => ({
        id: `entry_${i}`,
        organizationId: "org_test",
        kind: e.kind,
        scope: e.scope,
        title: `Title ${i}`,
        content: e.content,
        version: 1,
        active: true,
        priority: e.priority,
        updatedAt: e.updatedAt,
        createdAt: new Date(),
      })),
    ),
  };
}

describe("ContextResolverImpl", () => {
  it("resolves single requirement to named variable", async () => {
    const store = mockStore([
      {
        kind: "playbook",
        scope: "objection-handling",
        content: "Handle price objections by...",
        priority: 0,
        updatedAt: new Date(),
      },
    ]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      {
        kind: "playbook",
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: true,
      },
    ]);

    expect(result.variables.PLAYBOOK_CONTEXT).toBe("Handle price objections by...");
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0]!.entriesFound).toBe(1);
  });

  it("concatenates multiple entries for same scope by priority DESC", async () => {
    const store = mockStore([
      {
        kind: "playbook",
        scope: "objection-handling",
        content: "High priority content",
        priority: 10,
        updatedAt: new Date(),
      },
      {
        kind: "playbook",
        scope: "objection-handling",
        content: "Low priority content",
        priority: 0,
        updatedAt: new Date(),
      },
    ]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      {
        kind: "playbook",
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: true,
      },
    ]);

    expect(result.variables.PLAYBOOK_CONTEXT).toBe(
      "High priority content\n---\nLow priority content",
    );
    expect(result.metadata[0]!.entriesFound).toBe(2);
  });

  it("throws ContextResolutionError for missing required knowledge", async () => {
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store);

    await expect(
      resolver.resolve("org_test", [
        { kind: "playbook", scope: "nonexistent", injectAs: "PLAYBOOK_CONTEXT", required: true },
      ]),
    ).rejects.toThrow(ContextResolutionError);
  });

  it("omits missing optional knowledge from variables", async () => {
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      { kind: "knowledge", scope: "offer-catalog", injectAs: "KNOWLEDGE_CONTEXT", required: false },
    ]);

    expect(result.variables).not.toHaveProperty("KNOWLEDGE_CONTEXT");
    expect(result.metadata[0]!.entriesFound).toBe(0);
  });

  it("resolves multiple requirements into separate variables", async () => {
    const store = {
      findActive: vi.fn().mockResolvedValue([
        {
          id: "1",
          organizationId: "org_test",
          kind: "playbook",
          scope: "objection-handling",
          title: "T1",
          content: "Playbook content",
          version: 1,
          active: true,
          priority: 0,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: "2",
          organizationId: "org_test",
          kind: "policy",
          scope: "messaging-rules",
          title: "T2",
          content: "Policy content",
          version: 1,
          active: true,
          priority: 0,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      ]),
    };
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      {
        kind: "playbook",
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: true,
      },
      { kind: "policy", scope: "messaging-rules", injectAs: "POLICY_CONTEXT", required: true },
    ]);

    expect(result.variables.PLAYBOOK_CONTEXT).toBe("Playbook content");
    expect(result.variables.POLICY_CONTEXT).toBe("Policy content");
    expect(result.metadata).toHaveLength(2);
  });

  it("returns empty variables and metadata for empty requirements", async () => {
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", []);

    expect(result.variables).toEqual({});
    expect(result.metadata).toEqual([]);
  });
});

function makeFacts(): BusinessFacts {
  return {
    businessName: "Glow Dental",
    timezone: "Asia/Singapore",
    locations: [{ name: "Main", address: "123 Orchard Rd", parkingNotes: "Basement parking" }],
    openingHours: {
      monday: { open: "09:00", close: "18:00", closed: false },
      sunday: { open: "09:00", close: "18:00", closed: true },
    },
    services: [
      {
        name: "Cleaning",
        description: "Standard teeth cleaning",
        durationMinutes: 30,
        price: "150",
        currency: "SGD",
      },
    ],
    bookingPolicies: { cancellationPolicy: "24 hours notice required" },
    escalationContact: { name: "Dr Tan", channel: "whatsapp" as const, address: "+6591234567" },
    additionalFaqs: [
      { question: "Do you have parking?", answer: "Yes, basement parking available" },
    ],
  };
}

function mockBusinessFactsStore(facts: BusinessFacts | null) {
  return { get: vi.fn().mockResolvedValue(facts) };
}

describe("ContextResolverImpl — business-facts", () => {
  it("resolves business-facts from BusinessFactsStore", async () => {
    const facts = makeFacts();
    const factsStore = mockBusinessFactsStore(facts);
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store, factsStore);

    const result = await resolver.resolve("org_test", [
      {
        kind: "business-facts" as KnowledgeKind,
        scope: "operator-approved",
        injectAs: "BUSINESS_FACTS",
        required: true,
      },
    ]);

    expect(result.variables.BUSINESS_FACTS).toContain("Glow Dental");
    expect(result.variables.BUSINESS_FACTS).toContain("123 Orchard Rd");
    expect(result.variables.BUSINESS_FACTS).toContain("09:00");
    expect(result.variables.BUSINESS_FACTS).toContain("Cleaning");
    expect(result.variables.BUSINESS_FACTS).toContain("150 SGD");
    expect(result.variables.BUSINESS_FACTS).toContain("Dr Tan");
    expect(result.variables.BUSINESS_FACTS).toContain("Do you have parking?");
    expect(factsStore.get).toHaveBeenCalledWith("org_test");
  });

  it("throws ContextResolutionError when business-facts required but missing", async () => {
    const factsStore = mockBusinessFactsStore(null);
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store, factsStore);

    await expect(
      resolver.resolve("org_test", [
        {
          kind: "business-facts" as KnowledgeKind,
          scope: "operator-approved",
          injectAs: "BUSINESS_FACTS",
          required: true,
        },
      ]),
    ).rejects.toThrow(ContextResolutionError);
  });

  it("omits business-facts variable when optional and missing", async () => {
    const factsStore = mockBusinessFactsStore(null);
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store, factsStore);

    const result = await resolver.resolve("org_test", [
      {
        kind: "business-facts" as KnowledgeKind,
        scope: "operator-approved",
        injectAs: "BUSINESS_FACTS",
        required: false,
      },
    ]);

    expect(result.variables).not.toHaveProperty("BUSINESS_FACTS");
  });

  it("resolves business-facts alongside other kinds", async () => {
    const facts = makeFacts();
    const factsStore = mockBusinessFactsStore(facts);
    const store = mockStore([
      {
        kind: "playbook" as KnowledgeKind,
        scope: "objection-handling",
        content: "Playbook text",
        priority: 0,
        updatedAt: new Date(),
      },
    ]);
    const resolver = new ContextResolverImpl(store, factsStore);

    const result = await resolver.resolve("org_test", [
      {
        kind: "playbook" as KnowledgeKind,
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: true,
      },
      {
        kind: "business-facts" as KnowledgeKind,
        scope: "operator-approved",
        injectAs: "BUSINESS_FACTS",
        required: true,
      },
    ]);

    expect(result.variables.PLAYBOOK_CONTEXT).toBe("Playbook text");
    expect(result.variables.BUSINESS_FACTS).toContain("Glow Dental");
    expect(result.metadata).toHaveLength(2);
  });
});
