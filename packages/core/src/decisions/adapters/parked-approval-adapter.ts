import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { Decision, DecisionPresentation, RiskContract } from "../types.js";
import type { WorkTrace } from "../../platform/work-trace.js";
import { scoreParkedApproval } from "../urgency.js";
import { resolveAgentKey } from "../agent-key-resolver.js";

/** Subset of LifecycleRecord the adapter needs (keeps core decisions decoupled). */
export interface ParkedLifecycleLike {
  id: string;
  status: string;
  organizationId: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface ParkedRevisionLike {
  bindingHash: string;
}

export interface ParkedApprovalContext {
  intent: string;
  parameters: Record<string, unknown>;
  actorId: string;
  organizationId: string;
}

export interface ParkedApprovalSummary {
  humanSummary: string;
  dataLines?: ReadonlyArray<string | string[]>;
  presentation?: Partial<
    Pick<DecisionPresentation, "primaryLabel" | "secondaryLabel" | "dismissLabel">
  >;
  riskContract?: RiskContract;
  contactName?: string;
}

/**
 * Per-intent humanizer. Lives with the workflow modules that own the parameter
 * shapes (apps/api); core only defines the contract. Return null to fall
 * through to the default card.
 */
export type ParkedApprovalSummarizer = (ctx: ParkedApprovalContext) => ParkedApprovalSummary | null;

// Unknown governed work fails CLOSED toward caution: it may be client-facing
// or external, and under-warning is the wrong failure mode. Bespoke
// summarizers override with accurate contracts.
const DEFAULT_RISK: RiskContract = {
  riskLevel: "high",
  externalEffect: true,
  financialEffect: false,
  clientFacing: true,
  requiresConfirmation: true,
};

const SENSITIVE_KEY = /token|secret|key|password|phone|email|credential/i;
const PREVIEW_KEYS = 4;
const PREVIEW_VALUE_MAX = 60;

function parameterPreview(parameters: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(parameters).slice(0, PREVIEW_KEYS)) {
    if (SENSITIVE_KEY.test(key)) {
      lines.push(`${key}: [redacted]`);
      continue;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      const raw = String(value);
      lines.push(
        `${key}: ${raw.length > PREVIEW_VALUE_MAX ? `${raw.slice(0, PREVIEW_VALUE_MAX)}…` : raw}`,
      );
    } else {
      lines.push(`${key}: [${Array.isArray(value) ? "list" : "object"}]`);
    }
  }
  return lines;
}

/**
 * Adapts a parked ApprovalLifecycle (+ its current revision and canonical
 * WorkTrace) into an operator-facing Decision. A `recovery_required` lifecycle
 * (approved but dispatch failed) renders as a Retry card at max urgency:
 * approved governed work that has not executed must outrank everything.
 */
export function adaptParkedApproval(
  lifecycle: ParkedLifecycleLike,
  revision: ParkedRevisionLike,
  trace: WorkTrace,
  summarizer?: ParkedApprovalSummarizer,
): Decision {
  const ctx: ParkedApprovalContext = {
    intent: trace.intent,
    parameters: trace.parameters ?? {},
    actorId: trace.actor.id,
    organizationId: trace.organizationId,
  };
  const summary = summarizer?.(ctx) ?? null;

  const agentKey = resolveAgentKey(trace.deploymentContext?.skillSlug);
  const agentName = AGENT_REGISTRY[agentKey]?.displayName ?? agentKey;
  const riskContract = summary?.riskContract ?? DEFAULT_RISK;
  const recovery = lifecycle.status === "recovery_required";

  const baseSummary =
    summary?.humanSummary ?? `${agentName} needs your approval to run ${trace.intent}.`;
  const defaultLines: Array<string | string[]> = [
    `Action: ${trace.intent}`,
    `Requested by ${trace.actor.id} via ${trace.trigger}`,
    `Waiting since ${lifecycle.createdAt.toISOString().slice(0, 10)}, expires ${lifecycle.expiresAt
      .toISOString()
      .slice(0, 10)}`,
    ...parameterPreview(ctx.parameters),
    "No bespoke summary for this action type yet.",
  ];

  const presentation: DecisionPresentation = {
    primaryLabel: recovery ? "Retry" : (summary?.presentation?.primaryLabel ?? "Approve"),
    secondaryLabel: summary?.presentation?.secondaryLabel ?? "Not now",
    dismissLabel: recovery ? "Not now" : (summary?.presentation?.dismissLabel ?? "Reject"),
    dataLines: summary?.dataLines ?? defaultLines,
  };

  return {
    id: `workflow_approval:${lifecycle.id}`,
    kind: "workflow_approval",
    orgId: trace.organizationId,
    agentKey,
    humanSummary: recovery ? `Approved, but it didn't run: ${baseSummary}` : baseSummary,
    presentation,
    urgencyScore: recovery
      ? 100
      : scoreParkedApproval({ expiresAt: lifecycle.expiresAt, riskLevel: riskContract.riskLevel }),
    createdAt: lifecycle.createdAt,
    threadHref: null,
    sourceRef: { kind: "workflow_approval", sourceId: lifecycle.id },
    meta: {
      ...(summary?.contactName ? { contactName: summary.contactName } : {}),
      slaDeadlineAt: lifecycle.expiresAt,
      riskLevel: riskContract.riskLevel,
      riskContract,
      bindingHash: revision.bindingHash,
      ...(recovery ? { dispatchFailed: true } : {}),
    },
  };
}

/**
 * A lifecycle whose trace or revision cannot be loaded must still surface:
 * mandatory governed work never silently vanishes from the operator. Approve
 * is impossible (no bindingHash is exposed); reject remains possible. The
 * caller logs the integrity failure.
 */
export function adaptDegradedParkedApproval(lifecycle: ParkedLifecycleLike): Decision {
  return {
    id: `workflow_approval:${lifecycle.id}`,
    kind: "workflow_approval",
    orgId: lifecycle.organizationId ?? "",
    // Deliberate misattribution: with no trace there is no skillSlug, so the
    // degraded card renders under the default agent identity (alex). The card
    // copy explains the record is missing; identity accuracy is secondary.
    agentKey: "alex",
    humanSummary: `An approval could not be fully loaded (id ${lifecycle.id.slice(0, 8)}). You can still reject it; approving needs the underlying work record.`,
    presentation: {
      primaryLabel: "Approve",
      secondaryLabel: "Not now",
      dismissLabel: "Reject",
      dataLines: [
        `Approval id: ${lifecycle.id}`,
        `Created ${lifecycle.createdAt.toISOString().slice(0, 10)}, expires ${lifecycle.expiresAt
          .toISOString()
          .slice(0, 10)}`,
        "The underlying work record is missing. Contact support if this persists.",
      ],
    },
    urgencyScore: 90,
    createdAt: lifecycle.createdAt,
    threadHref: null,
    sourceRef: { kind: "workflow_approval", sourceId: lifecycle.id },
    meta: {
      slaDeadlineAt: lifecycle.expiresAt,
      riskLevel: "high",
      riskContract: DEFAULT_RISK,
    },
  };
}
