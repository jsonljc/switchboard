import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrategistAgent } from "../strategist.js";
import type { AgentContext, AgentNotifier } from "../types.js";
import type { AdsOperatorConfig, BusinessProfile, SkinManifest } from "@switchboard/schemas";
import { ProfileResolver } from "../../profile/resolver.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockCalls = Array<Array<Record<string, any>>>;

/** Extract the campaign plan from the orchestrator's resolveAndPropose calls. */
function extractPlan(orchestrator: ReturnType<typeof createMockOrchestrator>) {
  const calls = orchestrator.resolveAndPropose.mock.calls as MockCalls;
  const planCall = calls.find((c) => c[0]?.actionType === "digital-ads.campaign.create");
  if (!planCall?.[0]) throw new Error("No campaign.create proposal found");
  return planCall[0].parameters.plan;
}

function createMockConfig(overrides?: Partial<AdsOperatorConfig>): AdsOperatorConfig {
  return {
    id: "op-1",
    organizationId: "org-1",
    adAccountIds: ["act_123"],
    platforms: ["meta"],
    automationLevel: "supervised",
    targets: {
      cpa: 15,
      roas: 3.0,
      dailyBudgetCap: 50,
    },
    schedule: {
      optimizerCronHour: 6,
      reportCronHour: 8,
      timezone: "America/New_York",
    },
    notificationChannel: {
      type: "telegram",
      chatId: "12345",
    },
    principalId: "user-1",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockProfile(): BusinessProfile {
  return {
    id: "clinic-demo",
    name: "Demo Clinic",
    version: "1.0.0",
    business: {
      name: "Bright Smile Dental",
      type: "dental_clinic",
      tagline: "Your smile, our passion",
      website: "https://brightsmile.example.com",
      timezone: "America/New_York",
    },
    services: {
      catalog: [
        { id: "cleaning", name: "Teeth Cleaning", category: "Preventive", typicalValue: 150 },
        { id: "whitening", name: "Teeth Whitening", category: "Cosmetic", typicalValue: 300 },
        { id: "implant", name: "Dental Implant", category: "Restorative", typicalValue: 3000 },
      ],
    },
    journey: {
      stages: [
        { id: "new_lead", name: "New Lead", metric: "count", terminal: false },
        { id: "booked", name: "Appointment Booked", metric: "count", terminal: false },
        { id: "completed", name: "Treatment Complete", metric: "count", terminal: true },
      ],
      primaryKPI: "booked",
    },
    llmContext: {
      persona: "Friendly dental receptionist",
      tone: "warm and professional",
    },
  };
}

function createMockSkin(
  funnelMode: "lead_gen" | "conversions" | "awareness" = "lead_gen",
): SkinManifest {
  return {
    id: "clinic",
    name: "Dental Clinic",
    version: "2.0.0",
    description: "Dental clinic skin",
    tools: { include: ["digital-ads.*", "crm.*"] },
    governance: { profile: "guarded" },
    language: { locale: "en-US" },
    funnelMode,
    leadChannel: "telegram",
    requiredCartridges: ["digital-ads", "crm"],
  };
}

function createMockNotifier(): AgentNotifier & {
  calls: Array<{ chatId: string; type: string; message: string }>;
} {
  const calls: Array<{ chatId: string; type: string; message: string }> = [];
  return {
    calls,
    async sendProactive(chatId: string, channelType: string, message: string) {
      calls.push({ chatId, type: channelType, message });
    },
  };
}

function createMockOrchestrator(options?: {
  snapshotData?: unknown;
  proposeResult?: "denied" | "approved" | "pending";
}) {
  const { snapshotData, proposeResult = "approved" } = options ?? {};

  return {
    resolveAndPropose: vi.fn().mockImplementation(async (req: { actionType: string }) => {
      if (req.actionType === "digital-ads.snapshot.fetch") {
        return {
          denied: false,
          envelope: { id: "env-snap", status: "approved" },
          explanation: "auto-approved",
        };
      }

      if (proposeResult === "denied") {
        return {
          denied: true,
          envelope: { id: "env-denied" },
          explanation: "denied by governance policy",
          decisionTrace: { checks: [], explanation: "denied" },
        };
      }

      if (proposeResult === "pending") {
        return {
          denied: false,
          envelope: { id: "env-pending", status: "pending_approval" },
          approvalRequest: { id: "apr-1", summary: "needs approval" },
          explanation: "requires approval",
        };
      }

      return {
        denied: false,
        envelope: { id: "env-exec", status: "approved" },
        explanation: "auto-approved",
      };
    }),
    executeApproved: vi.fn().mockImplementation(async (envelopeId: string) => {
      if (envelopeId === "env-snap" && snapshotData) {
        return { success: true, summary: "snapshot fetched", data: snapshotData, externalRefs: {} };
      }
      return { success: true, summary: "executed", data: null, externalRefs: {} };
    }),
    respondToApproval: vi.fn(),
    requestUndo: vi.fn(),
  };
}

function createMockStorage() {
  return {
    envelopes: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), save: vi.fn() },
    policies: { list: vi.fn().mockResolvedValue([]), save: vi.fn(), get: vi.fn(), delete: vi.fn() },
    identity: {
      getPrincipal: vi.fn().mockResolvedValue(null),
      savePrincipal: vi.fn(),
      getSpec: vi.fn().mockResolvedValue(null),
      saveSpec: vi.fn(),
    },
    approvals: { get: vi.fn(), save: vi.fn(), list: vi.fn().mockResolvedValue([]) },
    cartridges: { list: vi.fn().mockReturnValue([]), get: vi.fn(), register: vi.fn() },
    competence: {
      get: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
  };
}

function buildAgentContext(overrides?: {
  config?: Partial<AdsOperatorConfig>;
  snapshotData?: unknown;
  proposeResult?: "denied" | "approved" | "pending";
  funnelMode?: "lead_gen" | "conversions" | "awareness";
  includeProfile?: boolean;
  includeSkin?: boolean;
}): {
  ctx: AgentContext;
  notifier: ReturnType<typeof createMockNotifier>;
  orchestrator: ReturnType<typeof createMockOrchestrator>;
} {
  const {
    config: configOverrides,
    snapshotData,
    proposeResult,
    funnelMode = "lead_gen",
    includeProfile = true,
    includeSkin = true,
  } = overrides ?? {};

  const notifier = createMockNotifier();
  const orchestrator = createMockOrchestrator({ snapshotData, proposeResult });
  const resolver = new ProfileResolver();

  const ctx: AgentContext = {
    config: createMockConfig(configOverrides),
    orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
    storage: createMockStorage() as unknown as AgentContext["storage"],
    notifier,
    profile: includeProfile ? resolver.resolve(createMockProfile()) : undefined,
    skin: includeSkin
      ? ({
          manifest: createMockSkin(funnelMode),
          config: {},
        } as unknown as AgentContext["skin"])
      : undefined,
  };

  return { ctx, notifier, orchestrator };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StrategistAgent", () => {
  let agent: StrategistAgent;

  beforeEach(() => {
    agent = new StrategistAgent();
  });

  it("has correct id and name", () => {
    expect(agent.id).toBe("strategist");
    expect(agent.name).toBe("Strategist Agent");
  });

  // ── No profile scenario ──────────────────────────────────────────────

  describe("without business profile", () => {
    it("returns early with helpful message", async () => {
      const { ctx, notifier } = buildAgentContext({ includeProfile: false });

      const result = await agent.tick(ctx);

      expect(result.agentId).toBe("strategist");
      expect(result.summary).toContain("No business profile");
      expect(notifier.calls).toHaveLength(1);
      expect(result.actions).toHaveLength(0);
    });
  });

  // ── Lead generation funnel ───────────────────────────────────────────

  describe("lead_gen funnel mode", () => {
    it("generates a lead generation plan", async () => {
      const { ctx, notifier, orchestrator } = buildAgentContext({
        funnelMode: "lead_gen",
        snapshotData: [],
      });

      const result = await agent.tick(ctx);

      expect(result.agentId).toBe("strategist");
      expect(result.actions.some((a) => a.outcome === "generated")).toBe(true);
      expect(notifier.calls).toHaveLength(1);
      expect(notifier.calls[0]!.message).toContain("Lead Generation");

      // Verify the plan was proposed through governance
      const plan = extractPlan(orchestrator);
      expect(plan.funnelMode).toBe("lead_gen");
      expect(plan.campaigns.length).toBeGreaterThan(0);
      expect(plan.campaigns[0].objective).toBe("OUTCOME_LEADS");
    });

    it("uses lead_form destination type", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        funnelMode: "lead_gen",
        snapshotData: [],
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);
      expect(plan.campaigns[0].ads[0].destinationType).toBe("lead_form");
    });
  });

  // ── Conversions funnel ───────────────────────────────────────────────

  describe("conversions funnel mode", () => {
    it("generates a conversion-focused plan", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        funnelMode: "conversions",
        snapshotData: [],
      });

      const result = await agent.tick(ctx);

      expect(result.agentId).toBe("strategist");

      const plan = extractPlan(orchestrator);

      expect(plan.funnelMode).toBe("conversions");
      expect(plan.campaigns[0].objective).toBe("OUTCOME_SALES");
      expect(plan.campaigns[0].ads[0].destinationType).toBe("website");
      expect(plan.estimatedMetrics.cpa).toBeDefined();
    });
  });

  // ── Awareness funnel ─────────────────────────────────────────────────

  describe("awareness funnel mode", () => {
    it("generates an awareness plan", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        funnelMode: "awareness",
        snapshotData: [],
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.funnelMode).toBe("awareness");
      expect(plan.campaigns[0].objective).toBe("OUTCOME_AWARENESS");
      expect(plan.estimatedMetrics.reach).toBeDefined();
      // Awareness should have higher reach estimates
      expect(plan.estimatedMetrics.reach!).toBeGreaterThan(0);
    });
  });

  // ── Budget tiers ─────────────────────────────────────────────────────

  describe("budget tiers", () => {
    it("micro budget produces single campaign", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        config: { targets: { dailyBudgetCap: 10 } }, // $300/month = micro
        snapshotData: [],
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.campaigns).toHaveLength(1);
      expect(plan.campaigns[0].adSets).toHaveLength(1);
      expect(plan.rationale).toContain("limited budget");
    });

    it("small budget produces 1-2 campaigns", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        config: { targets: { dailyBudgetCap: 50 } }, // $1500/month = small
        snapshotData: [],
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.campaigns.length).toBeLessThanOrEqual(2);
      expect(plan.campaigns[0].adSets.length).toBeLessThanOrEqual(2);
    });

    it("medium budget produces 3 campaigns", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        config: { targets: { dailyBudgetCap: 300 } }, // $9000/month = medium
        snapshotData: [],
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.campaigns).toHaveLength(3);
      expect(plan.campaigns[0].adSets).toHaveLength(3);
    });

    it("large budget produces 4 campaigns", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        config: { targets: { dailyBudgetCap: 1000 } }, // $30000/month = large
        snapshotData: [],
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.campaigns).toHaveLength(4);
      expect(plan.campaigns[0].adSets).toHaveLength(4);
      expect(plan.rationale).toContain("strong budget");
    });
  });

  // ── Existing campaigns ───────────────────────────────────────────────

  describe("with existing campaigns", () => {
    it("adjusts plan when active campaigns exist", async () => {
      const existingCampaigns = [
        {
          id: "c1",
          name: "Existing Campaign",
          metrics: { spend: 50, conversions: 5 },
          budget: 50,
          status: "ACTIVE",
        },
      ];

      const { ctx, orchestrator } = buildAgentContext({
        snapshotData: existingCampaigns,
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.rationale).toContain("existing active campaigns");
    });

    it("infers budget from existing campaign spend when no dailyBudgetCap", async () => {
      const existingCampaigns = [
        {
          id: "c1",
          name: "Running",
          metrics: {},
          budget: 100,
          status: "ACTIVE",
        },
      ];

      const { ctx, orchestrator } = buildAgentContext({
        config: { targets: { cpa: 15 } }, // no dailyBudgetCap
        snapshotData: existingCampaigns,
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      // Budget inferred: 100 * 30 = $3000/month (small tier)
      expect(plan.monthlyBudget).toBe(3000);
    });
  });

  // ── Governance outcomes ──────────────────────────────────────────────

  describe("governance flow", () => {
    it("handles approved plans", async () => {
      const { ctx, notifier } = buildAgentContext({
        proposeResult: "approved",
        snapshotData: [],
      });

      const result = await agent.tick(ctx);

      expect(result.actions.some((a) => a.outcome === "executed")).toBe(true);
      expect(notifier.calls[0]!.message).toContain("Approved");
    });

    it("handles denied plans", async () => {
      const { ctx, notifier } = buildAgentContext({
        proposeResult: "denied",
        snapshotData: [],
      });

      const result = await agent.tick(ctx);

      expect(result.actions.some((a) => a.outcome === "denied")).toBe(true);
      expect(result.summary).toContain("denied");
      expect(notifier.calls[0]!.message).toContain("denied");
    });

    it("handles pending approval", async () => {
      const { ctx, notifier } = buildAgentContext({
        proposeResult: "pending",
        snapshotData: [],
      });

      const result = await agent.tick(ctx);

      expect(result.actions.some((a) => a.outcome === "pending_approval")).toBe(true);
      expect(notifier.calls[0]!.message).toContain("Awaiting Your Approval");
    });
  });

  // ── Plan structure validation ────────────────────────────────────────

  describe("plan structure", () => {
    it("includes business name in campaign names", async () => {
      const { ctx, orchestrator } = buildAgentContext({ snapshotData: [] });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.name).toContain("Bright Smile Dental");
      expect(plan.campaigns[0].name).toContain("Bright Smile Dental");
    });

    it("includes estimated metrics", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        funnelMode: "lead_gen",
        snapshotData: [],
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.estimatedMetrics.cpl).toBeDefined();
      expect(plan.estimatedMetrics.reach).toBeGreaterThan(0);
      expect(plan.estimatedMetrics.impressions).toBeGreaterThan(0);
      expect(plan.estimatedMetrics.conversions).toBeGreaterThan(0);
    });

    it("generates diverse creative angles", async () => {
      const { ctx, orchestrator } = buildAgentContext({ snapshotData: [] });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);
      const ads = plan.campaigns[0].ads;

      // Should have multiple ads with different creative types
      expect(ads.length).toBeGreaterThan(1);
      // First ad should be image, second video
      expect(ads[0].type).toBe("image");
      if (ads.length > 1) {
        expect(ads[1].type).toBe("video");
      }
    });

    it("includes bid strategy recommendation", async () => {
      const { ctx, orchestrator } = buildAgentContext({ snapshotData: [] });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.campaigns[0].bidStrategy).toBeDefined();
      expect(plan.campaigns[0].bidStrategy!.length).toBeGreaterThan(0);
    });

    it("includes targeting with location", async () => {
      const { ctx, orchestrator } = buildAgentContext({ snapshotData: [] });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);
      const adSet = plan.campaigns[0].adSets[0];

      expect(adSet.targeting.location).toBeDefined();
      expect(adSet.targeting.ageRange).toBeDefined();
    });

    it("sets vertical from business profile", async () => {
      const { ctx, orchestrator } = buildAgentContext({ snapshotData: [] });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.vertical).toBe("dental_clinic");
    });
  });

  // ── Notification ─────────────────────────────────────────────────────

  describe("notifications", () => {
    it("sends notification to configured channel", async () => {
      const { ctx, notifier } = buildAgentContext({ snapshotData: [] });

      await agent.tick(ctx);

      expect(notifier.calls).toHaveLength(1);
      expect(notifier.calls[0]!.chatId).toBe("12345");
      expect(notifier.calls[0]!.type).toBe("telegram");
    });

    it("includes budget info in notification", async () => {
      const { ctx, notifier } = buildAgentContext({ snapshotData: [] });

      await agent.tick(ctx);

      const message = notifier.calls[0]!.message;
      expect(message).toContain("$");
      expect(message).toContain("/day");
      expect(message).toContain("/month");
    });

    it("handles notification failure gracefully", async () => {
      const { ctx } = buildAgentContext({ snapshotData: [] });
      // Make notifier throw
      ctx.notifier = {
        async sendProactive() {
          throw new Error("Network error");
        },
      };

      // Should not throw — notification is non-critical
      const result = await agent.tick(ctx);
      expect(result.agentId).toBe("strategist");
    });
  });

  // ── Default funnel mode ──────────────────────────────────────────────

  describe("default funnel mode", () => {
    it("defaults to lead_gen when no skin provided", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        includeSkin: false,
        snapshotData: [],
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.funnelMode).toBe("lead_gen");
      expect(plan.campaigns[0].objective).toBe("OUTCOME_LEADS");
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles snapshot fetch error gracefully", async () => {
      const notifier = createMockNotifier();
      const orchestrator = createMockOrchestrator();
      orchestrator.resolveAndPropose.mockRejectedValueOnce(new Error("API error"));
      // Second call (campaign.create proposal) should work
      orchestrator.resolveAndPropose.mockResolvedValueOnce({
        denied: false,
        envelope: { id: "env-exec", status: "approved" },
        explanation: "auto-approved",
      });

      const resolver = new ProfileResolver();
      const ctx: AgentContext = {
        config: createMockConfig(),
        orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
        storage: createMockStorage() as unknown as AgentContext["storage"],
        notifier,
        profile: resolver.resolve(createMockProfile()),
        skin: { manifest: createMockSkin() } as unknown as AgentContext["skin"],
      };

      const result = await agent.tick(ctx);

      expect(result.agentId).toBe("strategist");
      expect(result.actions.some((a) => a.outcome === "error")).toBe(true);
      // Should still generate a plan despite snapshot error
      expect(result.actions.some((a) => a.outcome === "generated")).toBe(true);
    });

    it("uses default budget when no budget cap and no existing campaigns", async () => {
      const { ctx, orchestrator } = buildAgentContext({
        config: { targets: { cpa: 15 } }, // no dailyBudgetCap
        snapshotData: [], // no existing campaigns
      });

      await agent.tick(ctx);

      const plan = extractPlan(orchestrator);

      expect(plan.monthlyBudget).toBe(500); // default
    });
  });
});
