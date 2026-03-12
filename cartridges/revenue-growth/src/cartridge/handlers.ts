// ---------------------------------------------------------------------------
// Revenue Growth Cartridge — Handler Functions
// ---------------------------------------------------------------------------
// Extracted from cartridge/index.ts to keep file sizes manageable.
// Each handler is a standalone async function invoked by the cartridge.
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type {
  ScorerOutput,
  DiagnosticRunOutput,
  ConnectorHealth,
  Intervention,
  ConstraintType,
  Constraint,
} from "@switchboard/schemas";

import { collectNormalizedData, assignDataConfidenceTier } from "../data/normalizer.js";
import { scoreSignalHealth } from "../scorers/signal-health.js";
import { scoreCreativeDepth } from "../scorers/creative-depth.js";
import { scoreFunnelLeakage } from "../scorers/funnel-leakage.js";
import { scoreHeadroom } from "../scorers/headroom.js";
import { scoreSalesProcess } from "../scorers/sales-process.js";
import { identifyConstraints } from "../constraint-engine/engine.js";
import type { ScorerContext } from "../constraint-engine/engine.js";
import { generateIntervention } from "../action-engine/engine.js";
import { generateWeeklyDigest } from "../digest/generator.js";
import { InterventionLifecycle } from "../execution/lifecycle.js";
import { PostChangeMonitor } from "../monitoring/post-change-monitor.js";

import type { RevGrowthDeps } from "../data/normalizer.js";
import type { DiagnosticCycleRecord } from "../stores/interfaces.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function failResult(summary: string, step: string, start: number): ExecuteResult {
  return {
    success: false,
    summary,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step, error: summary }],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}

// ---------------------------------------------------------------------------
// handleRunDiagnostic
// ---------------------------------------------------------------------------

export async function handleRunDiagnostic(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const accountId = parameters["accountId"] as string;
  const organizationId = parameters["organizationId"] as string;

  if (!accountId || !organizationId) {
    return failResult(
      "Missing required parameters: accountId and organizationId",
      "validate",
      start,
    );
  }

  // 1. Collect and normalize data
  const normalizedData = await collectNormalizedData(accountId, organizationId, deps);
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
  if (deps?.cycleStore) {
    const previousCycle = await deps.cycleStore.getLatest(accountId);
    if (previousCycle) {
      previousPrimaryConstraintType = previousCycle.primaryConstraint ?? null;
    }
  }

  // 4. Build scorer context for calibration-aware scoring
  let scorerContext: ScorerContext | undefined;
  if (deps?.accountProfileStore) {
    const profile = await deps.accountProfileStore.getByAccountId(accountId);
    if (profile) {
      scorerContext = { accountProfile: profile };
    }
  }

  // 5. Identify constraints
  const { primary, secondary, constraintTransition } = identifyConstraints(
    scorerOutputs,
    previousPrimaryConstraintType,
    scorerContext,
  );

  // 6. Generate interventions via action engine
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

  // 7. Persist cycle and interventions to stores
  if (deps?.cycleStore) {
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
    await deps.cycleStore.save(cycleRecord);
  }

  if (deps?.interventionStore) {
    for (const intervention of interventions) {
      await deps.interventionStore.save(intervention);
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

// ---------------------------------------------------------------------------
// handleGetLatest
// ---------------------------------------------------------------------------

export async function handleGetLatest(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const accountId = parameters["accountId"] as string;
  if (!accountId) {
    return failResult("Missing required parameter: accountId", "validate", start);
  }

  if (deps?.cycleStore) {
    const latest = await deps.cycleStore.getLatest(accountId);
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

// ---------------------------------------------------------------------------
// handleGetConnectorStatus
// ---------------------------------------------------------------------------

export async function handleGetConnectorStatus(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const accountId = parameters["accountId"] as string;
  if (!accountId) {
    return failResult("Missing required parameter: accountId", "validate", start);
  }

  const connectors: ConnectorHealth[] = [
    {
      connectorId: "digital-ads",
      name: "Digital Ads Platform",
      status: deps ? "connected" : "disconnected",
      lastSyncAt: null,
      matchRate: null,
      errorMessage: deps ? null : "No data collection dependencies configured",
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

// ---------------------------------------------------------------------------
// handleApproveIntervention
// ---------------------------------------------------------------------------

export async function handleApproveIntervention(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const interventionId = parameters["interventionId"] as string;
  if (!interventionId) {
    return failResult("Missing required parameter: interventionId", "validate", start);
  }

  if (deps?.interventionStore) {
    await deps.interventionStore.updateStatus(interventionId, "APPROVED");
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

// ---------------------------------------------------------------------------
// handleDeferIntervention
// ---------------------------------------------------------------------------

export async function handleDeferIntervention(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const interventionId = parameters["interventionId"] as string;
  const reason = (parameters["reason"] as string) ?? "No reason provided";
  if (!interventionId) {
    return failResult("Missing required parameter: interventionId", "validate", start);
  }

  if (deps?.interventionStore) {
    await deps.interventionStore.updateStatus(interventionId, "DEFERRED");
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

// ---------------------------------------------------------------------------
// handleGenerateDigest
// ---------------------------------------------------------------------------

export async function handleGenerateDigest(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const accountId = parameters["accountId"] as string;
  if (!accountId) {
    return failResult("Missing required parameter: accountId", "validate", start);
  }

  if (!deps?.cycleStore) {
    return failResult("Cycle store not configured — cannot generate digest", "deps", start);
  }

  const cycles = await deps.cycleStore.listByAccount(accountId, 7);
  const interventions = deps.interventionStore
    ? await deps.interventionStore.listByAccount(accountId, { limit: 20 })
    : [];

  const digest = await generateWeeklyDigest(accountId, cycles, interventions, deps.llmClient);

  if (deps.digestStore) {
    await deps.digestStore.save(digest);
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

// ---------------------------------------------------------------------------
// handleExecuteIntervention — Transition and dispatch an intervention
// ---------------------------------------------------------------------------

export async function handleExecuteIntervention(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const interventionId = parameters["interventionId"] as string;
  if (!interventionId) {
    return failResult("Missing required parameter: interventionId", "validate", start);
  }

  if (!deps?.interventionStore) {
    return failResult("Intervention store not configured", "deps", start);
  }

  const intervention = await deps.interventionStore.getById(interventionId);
  if (!intervention) {
    return failResult(`Intervention ${interventionId} not found`, "lookup", start);
  }

  const lifecycle = new InterventionLifecycle();

  try {
    const executing = lifecycle.transition(intervention, "EXECUTING");
    const measuring = lifecycle.startMeasurement(executing);
    await deps.interventionStore.save(measuring);

    return {
      success: true,
      summary: `Intervention ${interventionId} now EXECUTING with measurement started`,
      externalRefs: { interventionId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: measuring,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return failResult(message, "transition", start);
  }
}

// ---------------------------------------------------------------------------
// handleMonitoringCheck — Run post-change monitoring
// ---------------------------------------------------------------------------

export async function handleMonitoringCheck(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const accountId = parameters["accountId"] as string;
  const organizationId = parameters["organizationId"] as string;

  if (!accountId || !organizationId) {
    return failResult(
      "Missing required parameters: accountId and organizationId",
      "validate",
      start,
    );
  }

  if (!deps) {
    return failResult("Dependencies not configured", "deps", start);
  }

  const monitor = new PostChangeMonitor();
  const checkpoints = await monitor.checkDueInterventions(deps, accountId, organizationId);

  const anomalies = checkpoints.filter((c) => c.anomalyDetected);

  return {
    success: true,
    summary: `Monitoring check complete: ${checkpoints.length} checkpoint(s), ${anomalies.length} anomaly(ies)`,
    externalRefs: { accountId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: { checkpoints, anomalies },
  };
}
