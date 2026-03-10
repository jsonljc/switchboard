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
  ConstraintType,
  Constraint,
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
import { generateWeeklyDigest } from "../digest/generator.js";

import type { RevGrowthDeps } from "../data/normalizer.js";
import type { DiagnosticCycleRecord } from "../stores/interfaces.js";

export class RevenueGrowthCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = REVENUE_GROWTH_MANIFEST;

  private deps: RevGrowthDeps | null = null;

  setDeps(deps: RevGrowthDeps): void {
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

      case "revenue-growth.digest.generate":
        return this.generateDigest(parameters, start);

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
        partialFailures: [{ step: "validate", error: "accountId and organizationId are required" }],
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

    // 3. Read previous primary constraint from store
    let previousPrimaryConstraintType: ConstraintType | null = null;
    if (this.deps?.cycleStore) {
      const previousCycle = await this.deps.cycleStore.getLatest(accountId);
      if (previousCycle) {
        previousPrimaryConstraintType = previousCycle.primaryConstraint ?? null;
      }
    }

    // 4. Identify constraints
    const { primary, secondary, constraintTransition } = identifyConstraints(
      scorerOutputs,
      previousPrimaryConstraintType,
    );

    // 5. Generate interventions via action engine
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

    // 6. Persist cycle and interventions to stores
    if (this.deps?.cycleStore) {
      const allConstraints: Constraint[] = [];
      if (primary) allConstraints.push(primary);
      allConstraints.push(...secondary);

      const cycleRecord: DiagnosticCycleRecord = {
        id: cycleId,
        accountId,
        organizationId,
        dataTier,
        scorerOutputs,
        constraints: allConstraints,
        primaryConstraint: primary?.type ?? null,
        previousPrimaryConstraint: previousPrimaryConstraintType,
        constraintTransition,
        interventions,
        startedAt: now,
        completedAt: now,
      };
      await this.deps.cycleStore.save(cycleRecord);
    }

    if (this.deps?.interventionStore) {
      for (const intervention of interventions) {
        await this.deps.interventionStore.save(intervention);
      }
    }

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

    if (this.deps?.cycleStore) {
      const latest = await this.deps.cycleStore.getLatest(accountId);
      if (latest) {
        return {
          success: true,
          summary: `Latest diagnostic for account ${accountId}: ${latest.primaryConstraint ?? "no constraint"}`,
          externalRefs: { accountId, cycleId: latest.id },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: latest,
        };
      }
    }

    return {
      success: true,
      summary: `No diagnostic history found for account ${accountId}`,
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

    if (this.deps?.interventionStore) {
      await this.deps.interventionStore.updateStatus(interventionId, "APPROVED");
    }

    return {
      success: true,
      summary: `Intervention ${interventionId} approved`,
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

    if (this.deps?.interventionStore) {
      await this.deps.interventionStore.updateStatus(interventionId, "DEFERRED");
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

  private async generateDigest(
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

    if (!this.deps?.cycleStore) {
      return {
        success: false,
        summary: "Cycle store not configured — cannot generate digest",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "deps", error: "cycleStore is required" }],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    const cycles = await this.deps.cycleStore.listByAccount(accountId, 7);
    const interventions = this.deps.interventionStore
      ? await this.deps.interventionStore.listByAccount(accountId, { limit: 20 })
      : [];

    const digest = await generateWeeklyDigest(
      accountId,
      cycles,
      interventions,
      this.deps.llmClient,
    );

    if (this.deps.digestStore) {
      await this.deps.digestStore.save(digest);
    }

    return {
      success: true,
      summary: `Weekly digest generated: ${digest.headline}`,
      externalRefs: { accountId, digestId: digest.id },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: digest,
    };
  }

  async getRiskInput(
    actionType: string,
    _parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<RiskInput> {
    if (
      actionType.includes("diagnostic") ||
      actionType.includes("connectors") ||
      actionType.includes("digest")
    ) {
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
