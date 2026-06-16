import { describe, it, expect, vi, afterEach } from "vitest";
import { alexBuilder } from "./alex.js";
import type { AgentContext } from "@switchboard/sdk";
import type { SkillStores } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";
import { interpolate } from "../template-engine.js";
import { createInMemoryMetrics, setMetrics } from "../../telemetry/metrics.js";

function createMockCtx(overrides?: Partial<AgentContext>): AgentContext {
  return {
    persona: {
      businessName: "Glow Aesthetics",
      tone: "friendly",
      qualificationCriteria: { budget: "above 200 SGD" },
      disqualificationCriteria: { underage: true },
      escalationRules: { complexCases: true },
      bookingLink: "https://cal.com/glow-aesthetics",
      customInstructions: "Always mention first-visit discount",
    },
    ...overrides,
  } as AgentContext;
}

function createMockStores(overrides?: Partial<SkillStores>): SkillStores {
  return {
    opportunityStore: {
      findActiveByContact: vi
        .fn()
        .mockResolvedValue([{ id: "opp_1", stage: "interested", createdAt: new Date() }]),
    },
    contactStore: {
      findById: vi.fn().mockResolvedValue({
        name: "Sarah",
        phone: "+6591234567",
        email: "sarah@example.com",
        source: "whatsapp",
      }),
    },
    activityStore: {
      listByDeployment: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as SkillStores;
}

const config = {
  deploymentId: "dep_1",
  orgId: "org_1",
  contactId: "contact_1",
  sessionId: "session_1",
};

describe("alexBuilder", () => {
  it("resolves parameters from context and stores", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, config, stores);

    expect(result.parameters.BUSINESS_NAME).toBe("Glow Aesthetics");
    expect(result.parameters.OPPORTUNITY_ID).toBe("opp_1");
    expect(result.parameters.LEAD_PROFILE).toEqual(expect.objectContaining({ name: "Sarah" }));
    expect(result.parameters.PERSONA_CONFIG).toEqual(
      expect.objectContaining({
        tone: "friendly",
        bookingLink: "https://cal.com/glow-aesthetics",
      }),
    );
    expect(result.injectedPatternIds).toEqual([]);
  });

  it("throws ParameterResolutionError when no active opportunity exists", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([]),
      } as never,
    });

    await expect(alexBuilder(ctx, config, stores)).rejects.toThrow(ParameterResolutionError);
  });

  it("picks most recent opportunity when multiple exist", async () => {
    const ctx = createMockCtx();
    const older = { id: "opp_old", stage: "interested", createdAt: new Date("2026-01-01") };
    const newer = { id: "opp_new", stage: "qualified", createdAt: new Date("2026-04-15") };
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([older, newer]),
      } as never,
    });

    const result = await alexBuilder(ctx, config, stores);
    expect(result.parameters.OPPORTUNITY_ID).toBe("opp_new");
  });

  it("does not include PIPELINE_STAGE parameter", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, config, stores);

    expect(result.parameters).not.toHaveProperty("PIPELINE_STAGE");
  });

  it("auto-creates Contact and Opportunity when none exists for a new lead", async () => {
    const ctx = createMockCtx();
    const createContact = vi.fn().mockResolvedValue({
      id: "contact_new",
      name: null,
      phone: "+6599999999",
      email: null,
      source: "whatsapp",
    });
    const createOpportunity = vi.fn().mockResolvedValue({
      id: "opp_auto",
      stage: "interested",
      createdAt: new Date(),
    });
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([]),
        create: createOpportunity,
      } as never,
      contactStore: {
        findById: vi.fn().mockResolvedValue(null),
        create: createContact,
      } as never,
    });

    const result = await alexBuilder(
      ctx,
      {
        ...config,
        phone: "+6599999999",
        channel: "whatsapp",
      },
      stores,
    );

    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        phone: "+6599999999",
        primaryChannel: "whatsapp",
        messagingOptIn: true,
        messagingOptInSource: "organic_inbound",
      }),
    );
    expect(createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        contactId: "contact_new",
      }),
    );
    expect(result.parameters.OPPORTUNITY_ID).toBe("opp_auto");
  });

  it("does not set messaging opt-in when auto-creating Contact for non-WhatsApp channel", async () => {
    const ctx = createMockCtx();
    const createContact = vi.fn().mockResolvedValue({
      id: "contact_new",
      name: null,
      phone: null,
    });
    const createOpportunity = vi.fn().mockResolvedValue({
      id: "opp_auto",
      stage: "interested",
      createdAt: new Date(),
    });
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([]),
        create: createOpportunity,
      } as never,
      contactStore: {
        findById: vi.fn().mockResolvedValue(null),
        create: createContact,
      } as never,
    });

    await alexBuilder(
      ctx,
      {
        ...config,
        channel: "telegram",
      },
      stores,
    );

    const callArgs = createContact.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.primaryChannel).toBe("telegram");
    expect(callArgs).not.toHaveProperty("messagingOptIn");
    expect(callArgs).not.toHaveProperty("messagingOptInSource");
  });

  it("auto-creates Opportunity only when Contact exists but no Opportunity", async () => {
    const ctx = createMockCtx();
    const createOpportunity = vi.fn().mockResolvedValue({
      id: "opp_auto",
      stage: "interested",
      createdAt: new Date(),
    });
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([]),
        create: createOpportunity,
      } as never,
      contactStore: {
        findById: vi.fn().mockResolvedValue({
          id: "contact_1",
          name: "Sarah",
          phone: "+6591234567",
        }),
      } as never,
    });

    const result = await alexBuilder(ctx, config, stores);

    expect(createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        contactId: "contact_1",
      }),
    );
    expect(result.parameters.OPPORTUNITY_ID).toBe("opp_auto");
  });

  it("builder always supplies OUTCOME_PATTERNS as a string (empty when no services)", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, config, stores);
    expect(typeof result.parameters.OUTCOME_PATTERNS).toBe("string");
    expect(result.parameters.OUTCOME_PATTERNS).toBe("");
    expect(result.injectedPatternIds).toEqual([]);
  });

  it("interpolate() leaves no unresolved {{OUTCOME_PATTERNS}} or Mustache section markers", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, config, stores);
    const template = "Before.\n{{OUTCOME_PATTERNS}}\nAfter.";
    const declarations: import("../types.js").ParameterDeclaration[] = [
      { name: "OUTCOME_PATTERNS", required: false, type: "string" },
    ];

    const rendered = interpolate(template, result.parameters, declarations);

    expect(rendered).not.toMatch(/\{\{/);
    expect(rendered).not.toMatch(/\{\{#|\{\{\//);
    expect(rendered).toBe("Before.\n\nAfter.");
  });

  it("OUTCOME_PATTERNS and injectedPatternIds are populated from ContextBuilder when services are provided", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const mockContextBuilder = {
      build: vi.fn().mockResolvedValue({
        retrievedChunks: [],
        learnedFacts: [],
        recentSummaries: [],
        outcomePatternContext:
          '<outcome-patterns>\n<pattern id="pat_x">x</pattern>\n</outcome-patterns>',
        injectedPatternIds: ["pat_x"],
        totalTokenEstimate: 10,
      }),
    };

    const result = await alexBuilder(ctx, config, stores, {
      contextBuilder:
        mockContextBuilder as unknown as import("../parameter-builder.js").SkillServices["contextBuilder"],
    });

    expect(result.parameters.OUTCOME_PATTERNS).toMatch(/<outcome-patterns>/);
    expect(result.injectedPatternIds).toEqual(["pat_x"]);
    expect(mockContextBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: config.orgId,
        agentId: "alex",
        deploymentId: config.deploymentId,
        query: "",
        contactId: "contact_1",
      }),
    );
  });

  it("surfaces resolvedContactId as parameters.contactId for an EXISTING contact", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, { ...config, contactId: "ct_existing" }, stores);
    expect(result.parameters.contactId).toBe("ct_existing");
  });

  it("surfaces the MINTED contactId for a brand-new lead", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "opp_new", stage: "new", createdAt: new Date() }),
      } as never,
      contactStore: {
        findById: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "ct_minted" }),
      } as never,
    });
    const result = await alexBuilder(ctx, { ...config, contactId: "ct_stale" }, stores);
    expect(result.parameters.contactId).toBe("ct_minted");
  });

  it("LEAD_PROFILE is sanitized — no phone/email/id", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores({
      contactStore: {
        findById: vi.fn().mockResolvedValue({
          id: "ct_1",
          name: "Jane",
          phone: "+65...",
          email: "j@x.com",
          stage: "new",
          source: "whatsapp",
        }),
      } as never,
    });
    const result = await alexBuilder(ctx, config, stores);
    expect(result.parameters.LEAD_PROFILE).toEqual({
      name: "Jane",
      stage: "new",
      source: "whatsapp",
    });
  });

  it("never calls findById with an undefined id; LEAD_PROFILE is null when no contact resolves", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi
          .fn()
          .mockResolvedValue([{ id: "opp", stage: "new", createdAt: new Date() }]),
      } as never,
      contactStore: {
        findById: vi.fn().mockResolvedValue(null),
      } as never,
    });
    const findByIdMock = stores.contactStore.findById as unknown as ReturnType<typeof vi.fn>;
    findByIdMock.mockClear();
    const result = await alexBuilder(ctx, { ...config, contactId: undefined as never }, stores);
    expect(result.parameters.LEAD_PROFILE).toBeNull();
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("CURRENT_DATETIME contains the date and timezone when facts.timezone is set", async () => {
    const ctx = createMockCtx();
    const fixedNow = new Date("2026-06-02T07:45:00Z");
    const stores = createMockStores({
      businessFactsStore: {
        get: vi.fn().mockResolvedValue({
          timezone: "Asia/Singapore",
          businessName: "Glow Aesthetics",
          locations: [{ name: "Main", address: "1 Orchard Rd" }],
          openingHours: {},
          services: [{ id: "s1", name: "Facial", description: "desc", durationMinutes: 30 }],
          escalationContact: { name: "Team", channel: "whatsapp", address: "+65..." },
          additionalFaqs: [],
        }),
      } as never,
    });
    const result = await alexBuilder(ctx, { ...config, now: () => fixedNow }, stores);
    const dt = result.parameters.CURRENT_DATETIME as string;
    expect(dt).toContain("2026-06-02");
    expect(dt).toContain("Asia/Singapore");
  });

  it("CURRENT_DATETIME falls back to Asia/Singapore timezone when no facts", async () => {
    const ctx = createMockCtx();
    const fixedNow = new Date("2026-06-02T07:45:00Z");
    const stores = createMockStores();
    const result = await alexBuilder(ctx, { ...config, now: () => fixedNow }, stores);
    const dt = result.parameters.CURRENT_DATETIME as string;
    expect(dt).toContain("2026-06-02");
    expect(dt).toContain("Asia/Singapore");
  });

  it("CURRENT_DATETIME uses facts.timezone and shows shifted local date/hour for a distinct zone", async () => {
    // 2026-06-02T07:45:00Z is 2026-06-02 03:45 in America/New_York (UTC-4 in EDT)
    // which differs from both UTC (07:45) and Asia/Singapore (15:45).
    // This guards that the builder actually reads facts.timezone, not just defaults it.
    const ctx = createMockCtx();
    const fixedNow = new Date("2026-06-02T07:45:00Z");
    const stores = createMockStores({
      businessFactsStore: {
        get: vi.fn().mockResolvedValue({
          timezone: "America/New_York",
          businessName: "Glow Aesthetics",
          locations: [{ name: "Main", address: "1 Orchard Rd" }],
          openingHours: {},
          services: [{ id: "s1", name: "Facial", description: "desc", durationMinutes: 30 }],
          escalationContact: { name: "Team", channel: "whatsapp", address: "+65..." },
          additionalFaqs: [],
        }),
      } as never,
    });
    const result = await alexBuilder(ctx, { ...config, now: () => fixedNow }, stores);
    const dt = result.parameters.CURRENT_DATETIME as string;
    // Local New York date is still 2026-06-02 but hour is 03
    expect(dt).toContain("2026-06-02");
    expect(dt).toContain("03:45");
    expect(dt).toContain("America/New_York");
    // Must NOT contain Singapore timezone
    expect(dt).not.toContain("Asia/Singapore");
  });

  it("BUSINESS_FACTS is rendered from businessFactsStore facts (hours, price, advance booking)", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores({
      businessFactsStore: {
        get: vi.fn().mockResolvedValue({
          businessName: "Glow Aesthetics",
          timezone: "Asia/Singapore",
          locations: [{ name: "Orchard", address: "391 Orchard Rd" }],
          openingHours: { monday: { open: "10:00", close: "20:00", closed: false } },
          services: [
            { name: "Botox", description: "Anti-wrinkle", price: "from $18/unit", currency: "SGD" },
          ],
          bookingPolicies: { advanceBookingDays: 60 },
          escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6560000000" },
          additionalFaqs: [],
        }),
      } as never,
    });
    const result = await alexBuilder(ctx, config, stores);
    const bf = result.parameters.BUSINESS_FACTS as string;
    expect(bf).toContain("10:00");
    expect(bf).toContain("from $18/unit");
    expect(bf).toContain("Advance booking: up to 60 days ahead (subject to availability)");
  });

  it("CURRENT_DATETIME degrades gracefully when facts.timezone is an invalid IANA string", async () => {
    // Invalid timezone strings like 'GMT+8', 'SGT', 'Singapore' cause Intl to throw
    // RangeError. The builder must catch and fall back to 'Asia/Singapore' (fail-open).
    const ctx = createMockCtx();
    const fixedNow = new Date("2026-06-02T07:45:00Z");
    const stores = createMockStores({
      businessFactsStore: {
        get: vi.fn().mockResolvedValue({
          timezone: "SGT", // invalid IANA string
          businessName: "Glow Aesthetics",
          locations: [],
          openingHours: {},
          services: [],
          escalationContact: { name: "Team", channel: "whatsapp", address: "+65..." },
          additionalFaqs: [],
        }),
      } as never,
    });
    // Must not throw; must return a valid CURRENT_DATETIME with fallback timezone
    const result = await alexBuilder(ctx, { ...config, now: () => fixedNow }, stores);
    const dt = result.parameters.CURRENT_DATETIME as string;
    expect(dt).toContain("2026-06-02");
    // Falls back to Asia/Singapore
    expect(dt).toContain("Asia/Singapore");
  });

  describe("F15: policyContextSlotEmpty metric (observability-only)", () => {
    afterEach(() => {
      // Restore the module-singleton metrics so this block's spy doesn't leak
      // into other test files sharing the same vitest worker.
      setMetrics(createInMemoryMetrics());
    });

    it("emits policyContextSlotEmpty{slot:business-facts} once when facts are null, output unchanged", async () => {
      const metrics = createInMemoryMetrics();
      const spy = vi.spyOn(metrics.policyContextSlotEmpty, "inc");
      setMetrics(metrics);

      const ctx = createMockCtx();
      const stores = createMockStores({
        businessFactsStore: {
          get: vi.fn().mockResolvedValue(null),
        } as never,
      });

      const result = await alexBuilder(ctx, config, stores);

      // The slot still degrades to "" — prompt render must stay byte-identical.
      expect(result.parameters.BUSINESS_FACTS).toBe("");
      // ...but the empty resolution is now observable for the entitled org.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ orgId: "org_1", slot: "business-facts" });
    });

    it("does NOT emit policyContextSlotEmpty when facts are present", async () => {
      const metrics = createInMemoryMetrics();
      const spy = vi.spyOn(metrics.policyContextSlotEmpty, "inc");
      setMetrics(metrics);

      const ctx = createMockCtx();
      const stores = createMockStores({
        businessFactsStore: {
          get: vi.fn().mockResolvedValue({
            businessName: "Glow Aesthetics",
            timezone: "Asia/Singapore",
            locations: [{ name: "Orchard", address: "391 Orchard Rd" }],
            openingHours: { monday: { open: "10:00", close: "20:00", closed: false } },
            services: [{ name: "Botox", description: "Anti-wrinkle", price: "from $18/unit" }],
            escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6560000000" },
            additionalFaqs: [],
          }),
        } as never,
      });

      const result = await alexBuilder(ctx, config, stores);

      expect(result.parameters.BUSINESS_FACTS).not.toBe("");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("BOOKABLE_SERVICES (D3-1)", () => {
    const READY_PLAYBOOK = {
      businessIdentity: {
        name: "Glow",
        category: "medspa",
        tagline: "",
        location: "",
        status: "ready",
        source: "manual",
      },
      services: [
        {
          id: "botox",
          name: "Botox",
          price: 300,
          bookingBehavior: "ask_first",
          status: "ready",
          source: "manual",
        },
        {
          id: "draft",
          name: "Unconfirmed",
          price: 50,
          bookingBehavior: "ask_first",
          status: "missing",
          source: "scan",
        },
      ],
      hours: {
        timezone: "",
        schedule: {},
        afterHoursBehavior: "",
        status: "ready",
        source: "manual",
      },
      bookingRules: { leadVsBooking: "", status: "ready", source: "manual" },
      approvalMode: { status: "ready", source: "manual" },
      escalation: { triggers: [], toneBoundaries: "", status: "ready", source: "manual" },
      channels: { configured: [], status: "ready", source: "manual" },
    };

    it("renders BOOKABLE_SERVICES from a wired playbookReader (excludes status:missing)", async () => {
      const stores = createMockStores({
        playbookReader: { readForOrganization: vi.fn().mockResolvedValue(READY_PLAYBOOK) },
      } as never);
      const result = await alexBuilder(createMockCtx(), config, stores);
      expect(result.parameters.BOOKABLE_SERVICES).toBe("- Botox");
    });

    it("BOOKABLE_SERVICES is '' when no playbookReader is wired (back-compat)", async () => {
      const result = await alexBuilder(createMockCtx(), config, createMockStores());
      expect(result.parameters.BOOKABLE_SERVICES).toBe("");
    });

    it("BOOKABLE_SERVICES is '' when the playbook read returns null", async () => {
      const stores = createMockStores({
        playbookReader: { readForOrganization: vi.fn().mockResolvedValue(null) },
      } as never);
      const result = await alexBuilder(createMockCtx(), config, stores);
      expect(result.parameters.BOOKABLE_SERVICES).toBe("");
    });

    it("fail-open: a playbook read THROW never fails the turn; BOOKABLE_SERVICES is ''", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const stores = createMockStores({
        playbookReader: {
          readForOrganization: vi.fn().mockRejectedValue(new Error("db down")),
        },
      } as never);
      const result = await alexBuilder(createMockCtx(), config, stores);
      expect(result.parameters.BOOKABLE_SERVICES).toBe("");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
