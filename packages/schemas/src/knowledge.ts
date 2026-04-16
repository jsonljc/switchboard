import { z } from "zod";

// ---------------------------------------------------------------------------
// Knowledge Entry — org-scoped, versioned curated knowledge
// ---------------------------------------------------------------------------

export const KnowledgeKindSchema = z.enum(["playbook", "policy", "knowledge"]);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SCREAMING_SNAKE = /^[A-Z][A-Z0-9_]*$/;

export const KnowledgeEntryCreateSchema = z.object({
  organizationId: z.string().min(1),
  kind: KnowledgeKindSchema,
  scope: z.string().regex(KEBAB_CASE, "Scope must be lowercase kebab-case"),
  title: z.string().trim().min(1),
  content: z.string().trim().min(1, "Content must not be blank"),
  priority: z.number().int().min(0).default(0),
});
export type KnowledgeEntryCreate = z.infer<typeof KnowledgeEntryCreateSchema>;

export const KnowledgeEntryUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1, "Content must not be blank").optional(),
  priority: z.number().int().min(0).optional(),
});
export type KnowledgeEntryUpdate = z.infer<typeof KnowledgeEntryUpdateSchema>;

export const KnowledgeEntrySchema = KnowledgeEntryCreateSchema.extend({
  id: z.string().min(1),
  version: z.number().int().positive(),
  active: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;

// ---------------------------------------------------------------------------
// Context Contract — skill-level knowledge requirements
// ---------------------------------------------------------------------------

export const ContextRequirementSchema = z.object({
  kind: KnowledgeKindSchema,
  scope: z.string().regex(KEBAB_CASE, "Scope must be lowercase kebab-case"),
  injectAs: z.string().regex(SCREAMING_SNAKE, "injectAs must be SCREAMING_SNAKE_CASE"),
  required: z.boolean().default(true),
});
export type ContextRequirement = z.infer<typeof ContextRequirementSchema>;
