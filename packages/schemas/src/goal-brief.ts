import { z } from "zod";

/**
 * Goal type — categorizes the user's high-level objective.
 */
export const GoalTypeSchema = z.enum([
  "optimize", // "get more leads", "improve ROAS", "maximize conversions"
  "investigate", // "why is CPL up?", "what's wrong with my funnel?"
  "execute", // "pause campaign X", "set budget to $50"
  "report", // "how are my ads?", "weekly performance"
  "maintain", // "keep CPL under $50", "maintain current performance"
]);
export type GoalType = z.infer<typeof GoalTypeSchema>;

/**
 * Success metric — quantifiable measure for goal completion.
 */
export const SuccessMetricSchema = z.object({
  /** Metric name (e.g., "cpl", "roas", "leads", "spend") */
  name: z.string(),
  /** Target direction */
  direction: z.enum(["increase", "decrease", "maintain", "target"]),
  /** Target value (if applicable) */
  targetValue: z.number().optional(),
  /** Unit (e.g., "USD", "count", "percent") */
  unit: z.string().optional(),
});
export type SuccessMetric = z.infer<typeof SuccessMetricSchema>;

/**
 * Goal constraint — boundary condition that must not be violated.
 */
export const GoalConstraintSchema = z.object({
  /** What is constrained (e.g., "daily_spend", "cpl") */
  field: z.string(),
  /** Operator */
  operator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
  /** Constraint value */
  value: z.number(),
  /** Unit */
  unit: z.string().optional(),
});
export type GoalConstraint = z.infer<typeof GoalConstraintSchema>;

/**
 * GoalBrief — structured representation of a user's objective.
 * Enables decomposition into multi-step plans.
 */
export const GoalBriefSchema = z.object({
  /** Unique goal ID */
  id: z.string(),
  /** Goal type classification */
  type: GoalTypeSchema,
  /** Plain-text objective description */
  objective: z.string(),
  /** Boundary conditions */
  constraints: z.array(GoalConstraintSchema),
  /** How to measure success */
  successMetrics: z.array(SuccessMetricSchema),
  /** Whether this goal can be broken into sub-steps */
  decomposable: z.boolean(),
  /** Extracted entity references (campaign names, IDs, etc.) */
  entityRefs: z.record(z.string(), z.string()).optional(),
  /** Raw slots from interpreter */
  slots: z.record(z.string(), z.unknown()).optional(),
});
export type GoalBrief = z.infer<typeof GoalBriefSchema>;
