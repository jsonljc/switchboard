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
} from "@switchboard/schemas";

import { REVENUE_GROWTH_MANIFEST } from "./manifest.js";
import { DEFAULT_REVENUE_GROWTH_GUARDRAILS } from "./defaults/guardrails.js";
import {
  handleRunDiagnostic,
  handleGetLatest,
  handleGetConnectorStatus,
  handleApproveIntervention,
  handleDeferIntervention,
  handleGenerateDigest,
  handleExecuteIntervention,
  handleMonitoringCheck,
} from "./handlers.js";
import {
  handleCreativeAnalyzeGaps,
  handleCreativeGenerateStrategy,
  handleCreativeDeployTest,
} from "./creative-handlers.js";

import type { RevGrowthDeps } from "../data/normalizer.js";

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
        return handleRunDiagnostic(parameters, this.deps, start);

      case "revenue-growth.diagnostic.latest":
        return handleGetLatest(parameters, this.deps, start);

      case "revenue-growth.connectors.status":
        return handleGetConnectorStatus(parameters, this.deps, start);

      case "revenue-growth.intervention.approve":
        return handleApproveIntervention(parameters, this.deps, start);

      case "revenue-growth.intervention.defer":
        return handleDeferIntervention(parameters, this.deps, start);

      case "revenue-growth.intervention.execute":
        return handleExecuteIntervention(parameters, this.deps, start);

      case "revenue-growth.digest.generate":
        return handleGenerateDigest(parameters, this.deps, start);

      case "revenue-growth.monitoring.check":
        return handleMonitoringCheck(parameters, this.deps, start);

      case "revenue-growth.creative.analyze-gaps":
        return handleCreativeAnalyzeGaps(parameters, this.deps, start);

      case "revenue-growth.creative.generate-strategy":
        return handleCreativeGenerateStrategy(parameters, this.deps, start);

      case "revenue-growth.creative.deploy-test":
        return handleCreativeDeployTest(parameters, this.deps, start);

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

  async getRiskInput(
    actionType: string,
    _parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<RiskInput> {
    if (
      actionType.includes("diagnostic") ||
      actionType.includes("connectors") ||
      actionType.includes("digest") ||
      actionType.includes("monitoring")
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
      capabilities: [
        "diagnostic",
        "constraint-analysis",
        "intervention-generation",
        "monitoring",
        "intervention-execution",
      ],
    };
  }
}
