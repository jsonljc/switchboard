import { z } from "zod";

/**
 * Executor type — determines which execution tier handles the task.
 * - deterministic: Pure logic, no LLM (e.g., pause/resume, status checks)
 * - l1-llm: Cheap/fast LLM (Haiku) — classification, simple extraction
 * - l2-llm: Mid-tier LLM (Sonnet) — generation, analysis, scoring
 * - l3-llm: Expensive LLM (Opus) — complex reasoning, multi-step planning
 * - human: Requires human intervention
 */
export const ExecutorTypeSchema = z.enum([
  "deterministic",
  "l1-llm",
  "l2-llm",
  "l3-llm",
  "human",
]);
export type ExecutorType = z.infer<typeof ExecutorTypeSchema>;

/**
 * Step type — categorizes what a capability does at a semantic level.
 * Used for plan decomposition and model routing.
 */
export const StepTypeSchema = z.enum([
  "FETCH",       // Read/query data from external source
  "COMPUTE",     // Run deterministic analysis on data
  "SUMMARIZE",   // Generate human-readable summary
  "DECIDE",      // Make a decision (LLM reasoning)
  "ASK_HUMAN",   // Prompt for human input
  "APPROVAL",    // Submit for governance approval
  "EXECUTE",     // Mutate external state
  "LOG",         // Record audit/telemetry
]);
export type StepType = z.infer<typeof StepTypeSchema>;

/**
 * Cost tier — rough classification of execution cost.
 */
export const CostTierSchema = z.enum(["free", "low", "medium", "high"]);
export type CostTier = z.infer<typeof CostTierSchema>;

/**
 * Capability descriptor — rich metadata for an available action.
 * Extends the flat `availableActions: string[]` with routing hints.
 */
export const CapabilityDescriptorSchema = z.object({
  /** The action type identifier (e.g., "digital-ads.campaign.pause") */
  actionType: z.string(),
  /** What executor tier should handle this */
  executorType: ExecutorTypeSchema,
  /** Semantic step classification */
  stepType: StepTypeSchema,
  /** Cost tier for budget routing */
  costTier: CostTierSchema,
  /** Context fields required for execution */
  requiredContext: z.array(z.string()),
  /** Human-readable description */
  description: z.string().optional(),
});
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;
