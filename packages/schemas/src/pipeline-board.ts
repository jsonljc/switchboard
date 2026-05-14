import { z } from "zod";
import { ObjectionRecordSchema, OpportunitySchema } from "./lifecycle.js";

/**
 * Minimal contact projection joined onto each opportunity for board rendering.
 * Smaller than ContactSchema so the wire payload stays compact (one row per
 * opportunity, up to a few hundred per board).
 */
export const PipelineBoardContactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  primaryChannel: z.enum(["whatsapp", "telegram", "dashboard"]),
});
export type PipelineBoardContact = z.infer<typeof PipelineBoardContactSchema>;

/**
 * Wire-shape mirror of ObjectionRecordSchema. The canonical schema in
 * `lifecycle.ts` uses `z.coerce.date()` for `raisedAt` / `resolvedAt`, which
 * turns into Date objects after parse. The board payload keeps dates as ISO
 * strings so React Query cache + JSON serialisation stay symmetrical with the
 * other date fields on the row.
 */
const PipelineBoardObjectionSchema = z.object({
  category: ObjectionRecordSchema.shape.category,
  raisedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

/**
 * One card on the opportunity pipeline board.
 *
 * Fields mirror OpportunitySchema; `contact` is the joined minimal projection.
 * Date fields are kept as ISO strings on the wire (Zod's `coerce.date()` on
 * OpportunitySchema returns Date objects after parse; we re-string them here
 * so React Query cache + JSON serialisation stay symmetrical).
 */
export const PipelineBoardOpportunitySchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  stage: OpportunitySchema.shape.stage,
  timeline: OpportunitySchema.shape.timeline,
  priceReadiness: OpportunitySchema.shape.priceReadiness,
  objections: z.array(PipelineBoardObjectionSchema),
  qualificationComplete: OpportunitySchema.shape.qualificationComplete,
  estimatedValue: z.number().int().nullable(),
  revenueTotal: z.number().int(),
  assignedAgent: z.string().nullable(),
  assignedStaff: z.string().nullable(),
  lostReason: z.string().nullable(),
  notes: z.string().nullable(),
  openedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  contact: PipelineBoardContactSchema,
});
export type PipelineBoardOpportunity = z.infer<typeof PipelineBoardOpportunitySchema>;

export const PipelineBoardResponseSchema = z.object({
  rows: z.array(PipelineBoardOpportunitySchema),
});
export type PipelineBoardResponse = z.infer<typeof PipelineBoardResponseSchema>;
