import { z } from "zod";

export const ResolvedEntityStatusSchema = z.enum(["resolved", "ambiguous", "not_found"]);
export type ResolvedEntityStatus = z.infer<typeof ResolvedEntityStatusSchema>;

export const EntityAlternativeSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number().min(0).max(1),
});
export type EntityAlternative = z.infer<typeof EntityAlternativeSchema>;

export const ResolvedEntitySchema = z.object({
  id: z.string(),
  inputRef: z.string(),
  resolvedType: z.string(),
  resolvedId: z.string(),
  resolvedName: z.string(),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(EntityAlternativeSchema),
  status: ResolvedEntityStatusSchema,
});
export type ResolvedEntity = z.infer<typeof ResolvedEntitySchema>;
