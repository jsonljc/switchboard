import { z } from "zod";

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
    }),
  ),
});

export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;
