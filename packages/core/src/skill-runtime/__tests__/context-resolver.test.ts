import { describe, it, expect, vi } from "vitest";
import {
  ContextResolverImpl,
  renderBusinessFacts,
  renderBookableServices,
} from "../context-resolver.js";
import type { KnowledgeKind, BusinessFacts, PlaybookService } from "@switchboard/schemas";
import { resolveBookedValueCents } from "../tools/booking-value.js";
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

  it("sorts entries by priority descending", async () => {
    const store = mockStore([
      {
        kind: "playbook",
        scope: "test",
        content: "Low priority",
        priority: 1,
        updatedAt: new Date("2026-01-01"),
      },
      {
        kind: "playbook",
        scope: "test",
        content: "High priority",
        priority: 10,
        updatedAt: new Date("2026-01-01"),
      },
    ]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      { kind: "playbook", scope: "test", injectAs: "RESULT", required: true },
    ]);

    expect(result.variables.RESULT).toBe("High priority\n---\nLow priority");
  });

  it("breaks priority ties by recency (newer first)", async () => {
    const store = mockStore([
      {
        kind: "playbook",
        scope: "test",
        content: "Older entry",
        priority: 5,
        updatedAt: new Date("2026-01-01"),
      },
      {
        kind: "playbook",
        scope: "test",
        content: "Newer entry",
        priority: 5,
        updatedAt: new Date("2026-04-01"),
      },
    ]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      { kind: "playbook", scope: "test", injectAs: "RESULT", required: true },
    ]);

    expect(result.variables.RESULT).toBe("Newer entry\n---\nOlder entry");
  });

  it("truncates at entry boundaries when exceeding maxCharsPerRequirement", async () => {
    const longContent = "A".repeat(3000);
    const shortContent = "B".repeat(2000);
    const store = mockStore([
      {
        kind: "playbook",
        scope: "test",
        content: longContent,
        priority: 10,
        updatedAt: new Date("2026-01-01"),
      },
      {
        kind: "playbook",
        scope: "test",
        content: shortContent,
        priority: 5,
        updatedAt: new Date("2026-01-01"),
      },
    ]);
    const resolver = new ContextResolverImpl(store, { maxCharsPerRequirement: 4000 });

    const result = await resolver.resolve("org_test", [
      { kind: "playbook", scope: "test", injectAs: "RESULT", required: true },
    ]);

    expect(result.variables.RESULT).toContain(longContent);
    expect(result.variables.RESULT).not.toContain(shortContent);
    expect(result.variables.RESULT).toContain("[... truncated;");
    const meta = result.metadata[0]!;
    expect(meta.wasTruncated).toBe(true);
    expect(meta.originalChars).toBeGreaterThan(4000);
  });

  it("does not truncate when under cap", async () => {
    const content = "Short content";
    const store = mockStore([
      {
        kind: "playbook",
        scope: "test",
        content,
        priority: 5,
        updatedAt: new Date("2026-01-01"),
      },
    ]);
    const resolver = new ContextResolverImpl(store, { maxCharsPerRequirement: 4000 });

    const result = await resolver.resolve("org_test", [
      { kind: "playbook", scope: "test", injectAs: "RESULT", required: true },
    ]);

    const meta = result.metadata[0]!;
    expect(meta.wasTruncated).toBe(false);
    expect(meta.originalChars).toBe(content.length);
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

  it("renders all extended Service fields when present", async () => {
    const facts: BusinessFacts = {
      businessName: "Glow Medspa",
      timezone: "Asia/Singapore",
      locations: [{ name: "Main", address: "1 Orchard Rd" }],
      openingHours: {
        monday: { open: "09:00", close: "18:00", closed: false },
      },
      services: [
        {
          name: "Botox",
          description: "Cosmetic injection",
          durationMinutes: 45,
          price: "600",
          currency: "SGD",
          idealFor: "fine lines",
          notSuitableFor: "pregnant clients",
          bookingBehavior: "consultation_only",
          consultationRequired: true,
          prepInstructions: "Avoid blood thinners 48h before",
          aftercareNotes: "No exercise for 24h",
          popularCombinations: ["Filler", "HydraFacial"],
        },
      ],
      escalationContact: { name: "Dr Tan", channel: "whatsapp" as const, address: "+6591234567" },
      additionalFaqs: [],
    };
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

    const rendered = result.variables.BUSINESS_FACTS!;
    expect(rendered).toContain("Ideal for: fine lines");
    expect(rendered).toContain("Not suitable for: pregnant clients");
    expect(rendered).toContain("Booking: consultation_only");
    expect(rendered).toContain("Consultation required.");
    expect(rendered).toContain("Prep: Avoid blood thinners 48h before");
    expect(rendered).toContain("Aftercare: No exercise for 24h");
    expect(rendered).toContain("Often combined with: Filler, HydraFacial");
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

describe("renderBusinessFacts — advanceBookingDays", () => {
  it("renders advanceBookingDays as non-promissory context", () => {
    const facts = makeFacts();
    facts.bookingPolicies = { advanceBookingDays: 60 };
    expect(renderBusinessFacts(facts)).toContain(
      "Advance booking: up to 60 days ahead (subject to availability)",
    );
  });

  it("omits the advance-booking line when not set", () => {
    const facts = makeFacts();
    facts.bookingPolicies = { cancellationPolicy: "24 hours notice required" };
    expect(renderBusinessFacts(facts)).not.toContain("Advance booking");
  });
});

function bookableSvc(o: Partial<PlaybookService> & { id: string; name: string }): PlaybookService {
  return {
    id: o.id,
    name: o.name,
    price: o.price,
    duration: o.duration,
    bookingBehavior: o.bookingBehavior ?? "ask_first",
    status: o.status ?? "ready",
    source: o.source ?? "manual",
  };
}

describe("renderBookableServices (D3-1)", () => {
  const services = [
    bookableSvc({ id: "botox", name: "Botox", price: 300, status: "ready" }),
    bookableSvc({ id: "filler", name: "Dermal Filler", price: 600, status: "check_this" }),
    bookableSvc({ id: "consult", name: "Consultation", status: "ready" }), // unpriced bookable
    bookableSvc({ id: "draft", name: "Unconfirmed Draft", price: 100, status: "missing" }),
    bookableSvc({ id: "blank", name: "   ", price: 50, status: "ready" }), // blank name
  ];

  it("renders one bullet per confirmed, named service (trimmed names)", () => {
    const out = renderBookableServices(services);
    expect(out).toContain("- Botox");
    expect(out).toContain("- Dermal Filler");
    expect(out).toContain("- Consultation");
  });

  it("excludes status:missing entries and blank/whitespace names", () => {
    const out = renderBookableServices(services);
    expect(out).not.toContain("Unconfirmed Draft");
    const bullets = out.split("\n");
    expect(bullets).not.toContain("- "); // no blank-name bullet
    expect(bullets.filter((l) => l.startsWith("- "))).toHaveLength(3);
  });

  it("dedupes by case-insensitive trimmed name, keeping the first", () => {
    const dup = [
      bookableSvc({ id: "a", name: "Botox", price: 300 }),
      bookableSvc({ id: "b", name: " botox ", price: 999 }),
    ];
    expect(renderBookableServices(dup)).toBe("- Botox");
  });

  it("returns empty string for an empty list or an all-excluded list", () => {
    expect(renderBookableServices([])).toBe("");
    expect(renderBookableServices([bookableSvc({ id: "m", name: "X", status: "missing" })])).toBe(
      "",
    );
  });

  it("ALIGNMENT SEAM: every rendered name exists in the resolver's services (priced -> value)", () => {
    const out = renderBookableServices(services);
    const renderedNames = out.split("\n").map((l) => l.replace(/^- /, ""));
    expect(resolveBookedValueCents({ service: "Botox", services })).toBe(30000);
    expect(resolveBookedValueCents({ service: "Dermal Filler", services })).toBe(60000);
    // an unpriced bookable still MATCHES the resolver (abstains on price, never "absent").
    expect(resolveBookedValueCents({ service: "Consultation", services })).toBeNull();
    // structural guarantee: no name Alex is shown is a resolver non-match.
    for (const name of renderedNames) {
      const match = services.find(
        (s) => s.id === name || s.name.trim().toLowerCase() === name.toLowerCase(),
      );
      expect(match, `rendered name "${name}" must exist in the resolver's services`).toBeDefined();
    }
  });

  it("ALIGNMENT SEAM: duplicate names — renderer first-wins agrees with resolver first-wins", () => {
    // 2B hardening: an org with two same-named services at different prices. The
    // renderer shows ONE "- Botox" (first), and the resolver's `.find` also takes the
    // FIRST match — so they agree on WHICH real price stamps. Never a fabricated price;
    // the renderer must never diverge from the resolver's match order.
    const collide = [
      bookableSvc({ id: "botox_a", name: "Botox", price: 300 }),
      bookableSvc({ id: "botox_b", name: "Botox", price: 600 }),
    ];
    expect(renderBookableServices(collide)).toBe("- Botox");
    expect(resolveBookedValueCents({ service: "Botox", services: collide })).toBe(30000);
  });
});
