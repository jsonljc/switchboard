// ---------------------------------------------------------------------------
// PatientEngagementCartridge — implements Cartridge interface
// ---------------------------------------------------------------------------

import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
} from "@switchboard/schemas";
import type { AgentModule, AgentType } from "../agents/types.js";
import type {
  CalendarProvider,
  SMSProvider,
  ReviewPlatformProvider,
} from "./providers/provider.js";
import type { PatientMetricsSnapshot } from "../core/types.js";

import { PATIENT_ENGAGEMENT_MANIFEST } from "./manifest.js";
import { DEFAULT_PATIENT_ENGAGEMENT_GUARDRAILS } from "./defaults/guardrails.js";
import { computeRiskInput } from "./risk/categories.js";
import { resolveAgent } from "../agents/registry.js";

// Direct actions (not routed through agents)
import { executeDiagnosePipeline } from "./actions/diagnose-pipeline.js";
import { executeScoreLTV } from "./actions/score-ltv.js";
import { executeEscalate } from "./actions/escalate.js";
import { executeUpdateJourneyStage } from "./actions/update-journey-stage.js";

export class PatientEngagementCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = PATIENT_ENGAGEMENT_MANIFEST;

  private agents = new Map<AgentType, AgentModule>();
  private calendar: CalendarProvider | null = null;
  private sms: SMSProvider | null = null;
  private review: ReviewPlatformProvider | null = null;

  /** Snapshot provider for diagnostics (injected at bootstrap) */
  private snapshotProvider:
    | ((orgId: string, period: { since: string; until: string }) => Promise<PatientMetricsSnapshot>)
    | null = null;

  registerAgent(agent: AgentModule): void {
    this.agents.set(agent.type, agent);
  }

  setProviders(calendar: CalendarProvider, sms: SMSProvider, review: ReviewPlatformProvider): void {
    this.calendar = calendar;
    this.sms = sms;
    this.review = review;
  }

  setSnapshotProvider(
    provider: (
      orgId: string,
      period: { since: string; until: string },
    ) => Promise<PatientMetricsSnapshot>,
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
      case "patient-engagement.pipeline.diagnose": {
        if (!this.snapshotProvider) {
          return this.createMockDiagnostic(parameters);
        }
        const orgId = parameters.organizationId as string;
        const currentPeriod = parameters.currentPeriod as { since: string; until: string };
        const previousPeriod = parameters.previousPeriod as { since: string; until: string };
        const currentSnap = await this.snapshotProvider(orgId, currentPeriod);
        const previousSnap = await this.snapshotProvider(orgId, previousPeriod);
        return executeDiagnosePipeline(parameters, currentSnap, previousSnap);
      }

      case "patient-engagement.patient.score_ltv":
        return executeScoreLTV(parameters);

      case "patient-engagement.conversation.escalate":
        return executeEscalate(parameters);

      case "patient-engagement.journey.update_stage":
        return executeUpdateJourneyStage(parameters);

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
    return DEFAULT_PATIENT_ENGAGEMENT_GUARDRAILS;
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
    const { PATIENT_JOURNEY_SCHEMA } = await import("../core/types.js");
    const { analyzeJourney } = await import("../core/analysis/journey-walker.js");
    const { resolveAdvisors } = await import("../advisors/registry.js");

    const orgId = (params.organizationId as string) ?? "unknown";
    const emptySnapshot: PatientMetricsSnapshot = {
      organizationId: orgId,
      periodStart: "2024-01-01",
      periodEnd: "2024-01-07",
      totalPatients: 0,
      stages: {},
      aggregates: {
        averageTreatmentValue: 0,
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
      schema: PATIENT_JOURNEY_SCHEMA,
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
}
