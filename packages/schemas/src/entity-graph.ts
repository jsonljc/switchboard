import { z } from "zod";

export const EntityRefSchema = z.object({
  cartridgeId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

export const EntityMappingSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  refs: z.array(EntityRefSchema).min(2),
  label: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  createdBy: z.string(),
});
export type EntityMapping = z.infer<typeof EntityMappingSchema>;

export const CrossCartridgeEntityResolutionSchema = z.object({
  query: EntityRefSchema,
  mapping: EntityMappingSchema.nullable(),
  resolved: z.record(z.string(), EntityRefSchema),
});
export type CrossCartridgeEntityResolution = z.infer<typeof CrossCartridgeEntityResolutionSchema>;
