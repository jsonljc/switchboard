import { z } from "zod";

// ---------------------------------------------------------------------------
// Temporal Fact — schemas for entity-scoped temporal fact system
// ---------------------------------------------------------------------------

export const FactEntityTypeSchema = z.enum(["account", "campaign", "contact"]);
export type FactEntityType = z.infer<typeof FactEntityTypeSchema>;

export const FactCategorySchema = z.enum([
  "configuration",
  "performance",
  "status",
  "relationship",
  "human_assertion",
]);
export type FactCategory = z.infer<typeof FactCategorySchema>;

export const FactStatusSchema = z.enum(["active", "superseded", "retracted"]);
export type FactStatus = z.infer<typeof FactStatusSchema>;

export const FactSourceSchema = z.enum(["system", "api", "human"]);
export type FactSource = z.infer<typeof FactSourceSchema>;

export const FactValueTypeSchema = z.enum(["string", "number", "boolean", "json", "enum_value"]);
export type FactValueType = z.infer<typeof FactValueTypeSchema>;

export const SOURCE_TRUST_ORDER: Record<FactSource, number> = {
  system: 3,
  api: 2,
  human: 1,
};

export const RecordFactInputSchema = z
  .object({
    organizationId: z.string().min(1),
    deploymentId: z.string().min(1),
    entityType: FactEntityTypeSchema,
    entityId: z.string().min(1),
    category: FactCategorySchema,
    subject: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    valueText: z.string().optional(),
    valueJson: z.unknown().optional(),
    valueType: FactValueTypeSchema.default("string"),
    confidence: z.number().min(0).max(1).default(1.0),
    source: FactSourceSchema,
    sourceDetail: z.string().optional(),
    changeReason: z.string().optional(),
    validFrom: z.coerce.date().optional(),
    observedAt: z.coerce.date().optional(),
  })
  .refine((data) => data.valueText !== undefined || data.valueJson !== undefined, {
    message: "At least one of valueText or valueJson must be provided",
  });
export type RecordFactInput = z.infer<typeof RecordFactInputSchema>;

export const RetractFactInputSchema = z.object({
  reason: z.string().min(1),
});
export type RetractFactInput = z.infer<typeof RetractFactInputSchema>;

export const TemporalFactSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  deploymentId: z.string().min(1),
  entityType: FactEntityTypeSchema,
  entityId: z.string().min(1),
  category: FactCategorySchema,
  subject: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  valueText: z.string().nullable().optional(),
  valueJson: z.unknown().nullable().optional(),
  valueType: FactValueTypeSchema,
  confidence: z.number().min(0).max(1),
  source: FactSourceSchema,
  sourceDetail: z.string().nullable().optional(),
  changeReason: z.string().nullable().optional(),
  status: FactStatusSchema,
  supersededById: z.string().nullable().optional(),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date().nullable().optional(),
  observedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type TemporalFact = z.infer<typeof TemporalFactSchema>;
