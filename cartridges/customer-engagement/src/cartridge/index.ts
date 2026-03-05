// ---------------------------------------------------------------------------
// CustomerEngagementCartridge — implements Cartridge interface
// ---------------------------------------------------------------------------

import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
  BusinessProfile,
} from "@switchboard/schemas";
import type { AgentModule, AgentType } from "../agents/types.js";
import type {
  CalendarProvider,
  SMSProvider,
  ReviewPlatformProvider,
} from "./providers/provider.js";
import type { ContactMetricsSnapshot, JourneySchema } from "../core/types.js";
import type { LTVScoringConfig } from "../core/scoring/ltv-score.js";

import { CUSTOMER_ENGAGEMENT_MANIFEST } from "./manifest.js";
import { DEFAULT_CUSTOMER_ENGAGEMENT_GUARDRAILS } from "./defaults/guardrails.js";
import { computeRiskInput } from "./risk/categories.js";
import { resolveAgent } from "../agents/registry.js";

// Direct actions (not routed through agents)
import { executeDiagnosePipeline } from "./actions/diagnose-pipeline.js";
import { executeScoreLTV } from "./actions/score-ltv.js";
import { executeEscalate } from "./actions/escalate.js";
import { executeUpdateJourneyStage } from "./actions/update-journey-stage.js";

export class CustomerEngagementCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = CUSTOMER_ENGAGEMENT_MANIFEST;

  private agents = new Map<AgentType, AgentModule>();
  private calendar: CalendarProvider | null = null;
  private sms: SMSProvider | null = null;
  private review: ReviewPlatformProvider | null = null;
  private profile: BusinessProfile | null = null;

  /** Snapshot provider for diagnostics (injected at bootstrap) */
  private snapshotProvider:
    | ((orgId: string, period: { since: string; until: string }) => Promise<ContactMetricsSnapshot>)
    | null = null;

  registerAgent(agent: AgentModule): void {
    this.agents.set(agent.type, agent);
  }

  setProviders(calendar: CalendarProvider, sms: SMSProvider, review: ReviewPlatformProvider): void {
    this.calendar = calendar;
    this.sms = sms;
    this.review = review;
  }

  /** Inject a business profile for profile-driven configuration. */
  setProfile(profile: BusinessProfile): void {
    this.profile = profile;
  }

  /** Get the loaded business profile (if any). */
  getProfile(): BusinessProfile | null {
    return this.profile;
  }

  setSnapshotProvider(
    provider: (
      orgId: string,
      period: { since: string; until: string },
    ) => Promise<ContactMetricsSnapshot>,
  ): void {
    this.snapshotProvider = provider;
  }

  async initialize(_context: CartridgeContext): Promise<void> {
    // Initialization is handled by the bootstrap function
  }

  async enrichContext(
    _actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    // Return parameters as-is — enrichment is handled by agents and interceptors
    return { ...parameters };
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<ExecuteResult> {
    // Try agent routing first
    const agent = resolveAgent(actionType, this.agents);
    if (agent) {
      return agent.execute(actionType, parameters, context as unknown as Record<string, unknown>);
    }

    // Direct actions (no agent needed)
    switch (actionType) {
      case "customer-engagement.pipeline.diagnose": {
        if (!this.snapshotProvider) {
          return this.createMockDiagnostic(parameters);
        }
        const orgId = parameters.organizationId as string;
        const currentPeriod = parameters.currentPeriod as { since: string; until: string };
        const previousPeriod = parameters.previousPeriod as { since: string; until: string };
        const currentSnap = await this.snapshotProvider(orgId, currentPeriod);
        const previousSnap = await this.snapshotProvider(orgId, previousPeriod);
        return executeDiagnosePipeline(
          parameters,
          currentSnap,
          previousSnap,
          this.resolveJourneySchema(),
        );
      }

      case "customer-engagement.contact.score_ltv":
        return executeScoreLTV(parameters, this.resolveLTVConfig());

      case "customer-engagement.conversation.escalate":
        return executeEscalate(parameters);

      case "customer-engagement.journey.update_stage":
        return executeUpdateJourneyStage(parameters, this.resolveValidStages());

      default:
        return {
          success: false,
          summary: `Unknown action type: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "route", error: `No handler for ${actionType}` }],
          durationMs: 0,
          undoRecipe: null,
        };
    }
  }

  async getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<RiskInput> {
    return computeRiskInput(actionType, parameters, context);
  }

  getGuardrails(): GuardrailConfig {
    return DEFAULT_CUSTOMER_ENGAGEMENT_GUARDRAILS;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    const checks = await Promise.allSettled([
      this.calendar?.checkHealth(),
      this.sms?.checkHealth(),
      this.review?.checkHealth(),
    ]);

    const statuses = checks.map((c) =>
      c.status === "fulfilled" ? (c.value?.status ?? "disconnected") : "disconnected",
    );

    const allConnected = statuses.every((s) => s === "connected");
    const anyDisconnected = statuses.some((s) => s === "disconnected");

    return {
      status: allConnected ? "connected" : anyDisconnected ? "degraded" : "connected",
      latencyMs: 0,
      error: null,
      capabilities: [
        "lead_qualification",
        "appointment_management",
        "sms_reminders",
        "review_management",
        "cadence_automation",
        "journey_diagnostics",
      ],
    };
  }

  private async createMockDiagnostic(params: Record<string, unknown>): Promise<ExecuteResult> {
    const { CUSTOMER_JOURNEY_SCHEMA } = await import("../core/types.js");
    const { analyzeJourney } = await import("../core/analysis/journey-walker.js");
    const { resolveAdvisors } = await import("../advisors/registry.js");

    const orgId = (params.organizationId as string) ?? "unknown";
    const schema = this.resolveJourneySchema() ?? CUSTOMER_JOURNEY_SCHEMA;
    const emptySnapshot: ContactMetricsSnapshot = {
      organizationId: orgId,
      periodStart: "2024-01-01",
      periodEnd: "2024-01-07",
      totalContacts: 0,
      stages: {},
      aggregates: {
        averageServiceValue: 0,
        totalRevenue: 0,
        noShowRate: 0,
        cancellationRate: 0,
        averageResponseTimeMs: 0,
        reviewRating: null,
        reviewCount: 0,
        referralCount: 0,
      },
    };

    const result = analyzeJourney({
      schema,
      current: emptySnapshot,
      previous: emptySnapshot,
      periods: {
        current: { since: "2024-01-01", until: "2024-01-07" },
        previous: { since: "2023-12-25", until: "2023-12-31" },
      },
      advisors: resolveAdvisors("general"),
    });

    return {
      success: true,
      summary: `Pipeline diagnosis complete for org ${orgId} (mock data)`,
      externalRefs: { organizationId: orgId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
      data: result,
    };
  }

  /** Resolve LTV scoring config from profile, or undefined to use defaults. */
  private resolveLTVConfig(): LTVScoringConfig | undefined {
    if (!this.profile?.scoring) return undefined;
    return {
      referralValue: this.profile.scoring.referralValue,
      noShowCost: this.profile.scoring.noShowCost,
      retentionDecayRate: this.profile.scoring.retentionDecayRate,
      projectionYears: this.profile.scoring.projectionYears,
    };
  }

  /** Resolve valid journey stage IDs from profile, or undefined to use defaults. */
  private resolveValidStages(): string[] | undefined {
    if (!this.profile?.journey?.stages) return undefined;
    return this.profile.journey.stages.map((s) => s.id);
  }

  /** Resolve journey schema from profile, or undefined to use defaults. */
  private resolveJourneySchema(): JourneySchema | undefined {
    if (!this.profile?.journey) return undefined;
    return {
      stages: this.profile.journey.stages.map((s) => ({
        id: s.id,
        name: s.name,
        metric: s.metric,
        terminal: s.terminal,
      })),
      primaryKPI: this.profile.journey.primaryKPI,
    };
  }
}
