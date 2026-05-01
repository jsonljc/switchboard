import { z } from "zod";

// ── Constants ─────────────────────────────────────────────────────────────
/**
 * Single source of truth for the dashboard's freshness contract.
 * The API builder uses this to decide when to log a stale-rollup warning;
 * the Console uses it to decide when to render the "X min ago" footer.
 * Not a response field — would imply per-org configurability that doesn't exist.
 */
export const STALE_AFTER_MINUTES = 30;

// ── Building blocks for option C ──────────────────────────────────────────
export const AgentKeySchema = z.enum(["alex", "nova", "mira", "system"]);
export type AgentKey = z.infer<typeof AgentKeySchema>;

export const AdSetRowSchema = z.object({
  adSetId: z.string(),
  adSetName: z.string(),
  deploymentId: z.string(),
  spend: z.object({ amount: z.number(), currency: z.string() }),
  conversions: z.number(),
  cpa: z.number().nullable(),
  trend: z.enum(["up", "down", "flat"]),
  status: z.enum(["delivering", "learning", "limited", "paused"]),
  /** True when an approval with kind=pause_ad_set is pending against this row. Drives the Nova-panel cross-link pin. */
  pausePending: z.boolean(),
});
export type AdSetRow = z.infer<typeof AdSetRowSchema>;

export const StageProgressSchema = z.object({
  stageIndex: z.number().int().nonnegative(),
  stageTotal: z.number().int().positive(),
  stageLabel: z.string(),
  closesAt: z.string().nullable(),
});
export type StageProgress = z.infer<typeof StageProgressSchema>;

export const DashboardOverviewSchema = z.object({
  generatedAt: z.string(),

  greeting: z.object({
    period: z.enum(["morning", "afternoon", "evening"]),
    operatorName: z.string(),
  }),

  stats: z.object({
    pendingApprovals: z.number(),
    newInquiriesToday: z.number(),
    newInquiriesYesterday: z.number(),
    qualifiedLeads: z.number(),
    bookingsToday: z.number(),
    revenue7d: z.object({ total: z.number(), count: z.number() }),
    openTasks: z.number(),
    overdueTasks: z.number(),
  }),

  approvals: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      riskContext: z.string().nullable(),
      createdAt: z.string(),
      envelopeId: z.string(),
      bindingHash: z.string(),
      riskCategory: z.string(),
    }),
  ),

  bookings: z.array(
    z.object({
      id: z.string(),
      startsAt: z.string(),
      service: z.string(),
      contactName: z.string(),
      status: z.enum(["confirmed", "pending"]),
      channel: z.string().nullable(),
    }),
  ),

  funnel: z.object({
    inquiry: z.number(),
    qualified: z.number(),
    booked: z.number(),
    purchased: z.number(),
    completed: z.number(),
  }),

  revenue: z.object({
    total: z.number(),
    count: z.number(),
    topSource: z.object({ name: z.string(), amount: z.number() }).nullable(),
    periodDays: z.literal(7),
  }),

  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      dueAt: z.string().nullable(),
      isOverdue: z.boolean(),
      status: z.string(),
    }),
  ),

  activity: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      description: z.string(),
      dotColor: z.enum(["green", "amber", "blue", "gray"]),
      createdAt: z.string(),
      reasoning: z.string().nullable().optional(),
    }),
  ),
});

export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;
