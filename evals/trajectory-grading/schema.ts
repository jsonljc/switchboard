import { z } from "zod";
import type { ToolCallRecord } from "@switchboard/core/skill-runtime";

/**
 * Trajectory-grading eval fixture schema.
 *
 * A fixture is one work-unit case: the GOLDEN/ALLOWED ordered tool spec (`expected`) plus a
 * RECORDED ordered tool-call sequence (`trajectory`, shaped like a real `ToolCallRecord[]` from
 * `PrismaExecutionTraceStore.findByWorkUnitId`). The grader (`grade.ts`) compares them. The
 * harness is model-free, key-free and DB-free — like `evals/governance-decision`.
 *
 * The `expected` side is STRICTLY enumerated (it drives the real governance gate, so each
 * effectCategory / override must be a valid runtime value). The `trajectory` side is PERMISSIVE on
 * `governanceDecision` on purpose: the real executor records a fourth value `"simulated"` beyond the
 * three-value `GovernanceOutcome` type (skill-executor.ts force-casts it into the slot), and real
 * data may drift — so the loader accepts any string and the GRADER owns the semantics (recognized vs
 * malformed), which keeps the fail-closed behavior testable end-to-end through a JSONL fixture.
 */

export const EffectCategoryEnum = z.enum([
  "read",
  "propose",
  "simulate",
  "write",
  "external_send",
  "external_mutation",
  "irreversible",
]);
export type EffectCategoryLabel = z.infer<typeof EffectCategoryEnum>;

export const TrustLevelEnum = z.enum(["supervised", "guided", "autonomous"]);
export type TrustLevelLabel = z.infer<typeof TrustLevelEnum>;

export const GovernanceDecisionEnum = z.enum(["auto-approve", "require-approval", "deny"]);
export type GovernanceDecisionLabel = z.infer<typeof GovernanceDecisionEnum>;

/** The deterministic violation classes the grader can flag. */
export const ViolationKindEnum = z.enum([
  "tool-sequence-mismatch",
  "argument-invalid",
  "approval-bypassed",
  "malformed-record",
]);
export type ViolationKind = z.infer<typeof ViolationKindEnum>;

/** One step of the golden/allowed spec. `effectCategory` is a TOOL FACT, not the answer. */
export const ExpectedStepSchema = z.object({
  /** Tool id the call must use, in this position. */
  toolId: z.string().min(1),
  /** Operation name the call must use, in this position. */
  operation: z.string().min(1),
  /** The tool operation's effect category — fed to the REAL gate to derive the mandated outcome. */
  effectCategory: EffectCategoryEnum,
  /** Optional per-trust-level override the operation declares (mirrors SkillToolOperation). */
  governanceOverride: z.record(TrustLevelEnum, GovernanceDecisionEnum).optional(),
  /** Top-level param keys that must be present (non-null) in the recorded call's params. */
  requiredArgs: z.array(z.string()).optional(),
});
export type ExpectedStep = z.infer<typeof ExpectedStepSchema>;

/** One recorded tool call — the observed-data side, shaped like a real `ToolCallRecord`. */
export const RecordedCallSchema = z.object({
  toolId: z.string().min(1),
  operation: z.string().min(1),
  params: z.unknown(),
  /** The recorded ToolResult status, if present (`success` => the call executed). */
  result: z.object({ status: z.string() }).optional(),
  /** Recorded governance outcome. Permissive string: real data may carry "simulated" or drift. */
  governanceDecision: z.string().min(1),
});
export type RecordedCall = z.infer<typeof RecordedCallSchema>;

export const TrajectoryCaseSchema = z.object({
  /** Unique slug (kebab-case). Used in the report. */
  id: z.string().min(1),
  /** The deployment's resolved trust level for this work unit. */
  trustLevel: TrustLevelEnum,
  /** The golden/allowed ordered tool spec. */
  expected: z.array(ExpectedStepSchema),
  /** The recorded ordered tool-call sequence (LLM turn order). */
  trajectory: z.array(RecordedCallSchema),
  /** The verdict the grader MUST return for this case. */
  expectedVerdict: z.enum(["pass", "fail"]),
  /** For `fail` cases: the exact set of violation kinds the grader must flag (order-insensitive). */
  expectedViolationKinds: z.array(ViolationKindEnum).optional(),
  /** Free-text justification for human reviewers. */
  notes: z.string().optional(),
});
export type TrajectoryCase = z.infer<typeof TrajectoryCaseSchema>;

/**
 * Compile-time drift guard (cross-slice seam protection). A real `ToolCallRecord`'s
 * governance-relevant fields must stay assignable to `RecordedCall`, so the grader can consume real
 * `findByWorkUnitId` rows unchanged. If core renames/removes `governanceDecision` (or narrows a
 * field to something not assignable here), `pnpm typecheck` fails rather than the eval silently
 * grading a stale shape.
 */
type _CoreRecordIsGradeable =
  Pick<ToolCallRecord, "toolId" | "operation" | "params" | "governanceDecision"> extends Pick<
    RecordedCall,
    "toolId" | "operation" | "params" | "governanceDecision"
  >
    ? true
    : never;
export const _DRIFT_GUARD_CORE_RECORD: _CoreRecordIsGradeable = true;
