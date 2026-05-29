import { createHash } from "node:crypto";
import type { SkillTool, SkillToolOperation, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail, pendingApproval } from "../tool-result.js";
import type { ChildWorkSubmitter, DelegationTarget } from "../delegation-port.js";

export interface DelegateToolDeps {
  submitter: ChildWorkSubmitter;
  /** Allowlist of delegatable targets — one tool operation each. */
  targets: DelegationTarget[];
  /** Max delegation depth. Default 1 (a delegated child may not delegate again). */
  maxDepth?: number;
  /** Deterministic fingerprint of child params for the idempotency key. */
  hashParameters?: (params: Record<string, unknown>) => string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function defaultHash(params: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(params)).digest("hex").slice(0, 16);
}

export type DelegateToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Agent→agent governed delegation. Each configured target becomes one operation
 * (`delegate.<operation>`); the LLM cannot reach any other intent. Every call
 * routes through the injected ChildWorkSubmitter (PlatformIngress front door in
 * prod), so governance/idempotency/WorkTrace all run on the child. The tool
 * itself only PROPOSES — the real gate is the child submit.
 */
export function createDelegateToolFactory(deps: DelegateToolDeps): DelegateToolFactory {
  const maxDepth = deps.maxDepth ?? 1;
  const hash = deps.hashParameters ?? defaultHash;

  return (ctx: SkillRequestContext): SkillTool => {
    const operations: Record<string, SkillToolOperation> = {};
    for (const target of deps.targets) {
      operations[target.operation] = {
        description: target.description,
        effectCategory: "propose",
        idempotent: true,
        inputSchema: target.inputSchema,
        execute: async (params: unknown): Promise<ToolResult> => {
          const depth = ctx.delegationDepth ?? 0;
          if (depth >= maxDepth) {
            return fail("DELEGATION_DEPTH_EXCEEDED", "Delegated work cannot delegate again.", {
              modelRemediation:
                "Do not call delegate from delegated work; handle it directly or escalate.",
            });
          }
          if (!ctx.workUnitId) {
            return fail(
              "NO_PARENT_WORK_UNIT",
              "No parent work unit is available to anchor this delegation.",
              {
                modelRemediation:
                  "Delegation is unavailable here; handle the request directly or escalate.",
              },
            );
          }
          const childParameters: Record<string, unknown> = {
            ...target.mapInput(params),
            __delegationDepth: depth + 1,
          };
          const idempotencyKey = `delegate:${ctx.workUnitId}:${target.intent}:${hash(childParameters)}`;
          const result = await deps.submitter.submitChildWork({
            organizationId: ctx.orgId,
            actor: { id: ctx.actorId ?? ctx.deploymentId, type: "agent" },
            intent: target.intent,
            parameters: childParameters,
            parentWorkUnitId: ctx.workUnitId,
            idempotencyKey,
          });
          if (!result.ok) {
            return fail(
              "DELEGATION_FAILED",
              `Delegation to ${target.intent} failed: ${result.error ?? "unknown error"}.`,
              {
                modelRemediation:
                  "Tell the customer you'll have the team follow up; do not retry blindly.",
              },
            );
          }
          if (result.outcome === "pending_approval") {
            return pendingApproval(`Delegated ${target.intent}; awaiting team approval.`);
          }
          return ok({ childWorkUnitId: result.childWorkUnitId, outcome: result.outcome });
        },
      };
    }
    return { id: "delegate", operations };
  };
}
