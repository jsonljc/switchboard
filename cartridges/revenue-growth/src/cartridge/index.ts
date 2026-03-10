// ---------------------------------------------------------------------------
// RevenueGrowthCartridge — implements Cartridge interface
// ---------------------------------------------------------------------------
// Cyclic constraint-based controller that identifies the primary constraint
// limiting revenue growth and proposes targeted interventions.
// ---------------------------------------------------------------------------

import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
  ScorerOutput,
  DiagnosticRunOutput,
  ConnectorHealth,
  Intervention,
} from "@switchboard/schemas";

import { REVENUE_GROWTH_MANIFEST } from "./manifest.js";
import { DEFAULT_REVENUE_GROWTH_GUARDRAILS } from "./defaults/guardrails.js";
import { collectNormalizedData, assignDataConfidenceTier } from "../data/normalizer.js";
import { scoreSignalHealth } from "../scorers/signal-health.js";
import { scoreCreativeDepth } from "../scorers/creative-depth.js";
import { scoreFunnelLeakage } from "../scorers/funnel-leakage.js";
import { scoreHeadroom } from "../scorers/headroom.js";
import { scoreSalesProcess } from "../scorers/sales-process.js";
import { identifyConstraints } from "../constraint-engine/engine.js";
import { generateIntervention } from "../action-engine/engine.js";

import type { DataCollectionDeps } from "../data/normalizer.js";

export class RevenueGrowthCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = REVENUE_GROWTH_MANIFEST;

  private deps: DataCollectionDeps | null = null;

  setDeps(deps: DataCollectionDeps): void {
    this.deps = deps;
  }

  async initialize(_context: CartridgeContext): Promise<void> {
    // Initialization handled by bootstrap
  }

  async enrichContext(
    _actionType: string,
    _parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    return {};
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    const start = Date.now();

    switch (actionType) {
      case "revenue-growth.diagnostic.run":
        return this.runDiagnostic(parameters, start);

      case "revenue-growth.diagnostic.latest":
        return this.getLatest(parameters, start);

      case "revenue-growth.connectors.status":
        return this.getConnectorStatus(parameters, start);

      case "revenue-growth.intervention.approve":
        return this.approveIntervention(parameters, start);

      case "revenue-growth.intervention.defer":
        return this.deferIntervention(parameters, start);

      default:
        return {
          success: false,
          summary: `Unknown action type: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "execute", error: `Unknown action type: ${actionType}` }],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
    }
  }

  private async runDiagnostic(
    parameters: Record<string, unknown>,
    start: number,
  ): Promise<ExecuteResult> {
    const accountId = parameters["accountId"] as string;
    const organizationId = parameters["organizationId"] as string;

    if (!accountId || !organizationId) {
      return {
        success: false,
        summary: "Missing required parameters: accountId and organizationId",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [
          { step: "validate", error: "accountId and organizationId are required" },
        ],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    // 1. Collect and normalize data
    const normalizedData = await collectNormalizedData(accountId, organizationId, this.deps);
    const dataTier = assignDataConfidenceTier(normalizedData);

    // 2. Run all 5 scorers
    const scorerOutputs: ScorerOutput[] = [
      scoreSignalHealth(normalizedData),
      scoreCreativeDepth(normalizedData),
      scoreFunnelLeakage(normalizedData),
      scoreHeadroom(normalizedData),
      scoreSalesProcess(normalizedData),
    ];

    // 3. Identify constraints
    const { primary, secondary, constraintTransition } = identifyConstraints(
      scorerOutputs,
      null, // TODO: read previous from store in Phase 3
    );

    // 4. Generate interventions via action engine
    const cycleId = crypto.randomUUID();
    const interventions: Intervention[] = [];

    if (primary) {
      interventions.push(generateIntervention(primary, cycleId));
    }

    const now = new Date().toISOString();

    const output: DiagnosticRunOutput = {
      cycleId,
      accountId,
      dataTier,
      scorerOutputs,
      primaryConstraint: primary,
      secondaryConstraints: secondary,
      interventions,
      constraintTransition,
      completedAt: now,
    };

    return {
      success: true,
      summary: primary
        ? `Diagnostic complete. Primary constraint: ${primary.type} (score: ${primary.score}). Intervention proposed: ${interventions[0]?.actionType ?? "none"}`
        : "Diagnostic complete. No binding constraint identified.",
      externalRefs: { cycleId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: output,
    };
  }

  private async getLatest(
    parameters: Record<string, unknown>,
    start: number,
  ): Promise<ExecuteResult> {
    const accountId = parameters["accountId"] as string;
    if (!accountId) {
      return {
        success: false,
        summary: "Missing required parameter: accountId",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "validate", error: "accountId is required" }],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    // Placeholder — in Phase 3, this will read from PrismaInterventionStore
    return {
      success: true,
      summary: `Latest diagnostic for account ${accountId} (store not yet implemented)`,
      externalRefs: { accountId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  private async getConnectorStatus(
    parameters: Record<string, unknown>,
    start: number,
  ): Promise<ExecuteResult> {
    const accountId = parameters["accountId"] as string;
    if (!accountId) {
      return {
        success: false,
        summary: "Missing required parameter: accountId",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "validate", error: "accountId is required" }],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    const connectors: ConnectorHealth[] = [
      {
        connectorId: "digital-ads",
        name: "Digital Ads Platform",
        status: this.deps ? "connected" : "disconnected",
        lastSyncAt: null,
        matchRate: null,
        errorMessage: this.deps ? null : "No data collection dependencies configured",
      },
    ];

    return {
      success: true,
      summary: `Connector status for account ${accountId}: ${connectors.length} connectors`,
      externalRefs: { accountId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: connectors,
    };
  }

  private async approveIntervention(
    parameters: Record<string, unknown>,
    start: number,
  ): Promise<ExecuteResult> {
    const interventionId = parameters["interventionId"] as string;
    if (!interventionId) {
      return {
        success: false,
        summary: "Missing required parameter: interventionId",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "validate", error: "interventionId is required" }],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    return {
      success: true,
      summary: `Intervention ${interventionId} approved (store not yet implemented)`,
      externalRefs: { interventionId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  private async deferIntervention(
    parameters: Record<string, unknown>,
    start: number,
  ): Promise<ExecuteResult> {
    const interventionId = parameters["interventionId"] as string;
    const reason = (parameters["reason"] as string) ?? "No reason provided";
    if (!interventionId) {
      return {
        success: false,
        summary: "Missing required parameter: interventionId",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "validate", error: "interventionId is required" }],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    return {
      success: true,
      summary: `Intervention ${interventionId} deferred: ${reason}`,
      externalRefs: { interventionId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  async getRiskInput(
    actionType: string,
    _parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<RiskInput> {
    if (actionType.includes("diagnostic") || actionType.includes("connectors")) {
      return {
        baseRisk: "none",
        exposure: { dollarsAtRisk: 0, blastRadius: 0 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    }

    return {
      baseRisk: "low",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    };
  }

  getGuardrails(): GuardrailConfig {
    return DEFAULT_REVENUE_GROWTH_GUARDRAILS;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return {
      status: "connected",
      latencyMs: 0,
      error: null,
      capabilities: ["diagnostic", "constraint-analysis", "intervention-generation"],
    };
  }
}
