import { z } from "zod";
import { RiskCategorySchema } from "./risk.js";

export const ActionDefinitionSchema = z.object({
  actionType: z.string(),
  name: z.string(),
  description: z.string(),
  parametersSchema: z.record(z.string(), z.unknown()),
  baseRiskCategory: RiskCategorySchema,
  reversible: z.boolean(),
});
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

export const CartridgeManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  actions: z.array(ActionDefinitionSchema),
  requiredConnections: z.array(z.string()),
  defaultPolicies: z.array(z.string()),
});
export type CartridgeManifest = z.infer<typeof CartridgeManifestSchema>;

export const ConnectionHealthSchema = z.object({
  status: z.enum(["connected", "degraded", "disconnected"]),
  latencyMs: z.number(),
  error: z.string().nullable(),
  capabilities: z.array(z.string()),
});
export type ConnectionHealth = z.infer<typeof ConnectionHealthSchema>;

export const GuardrailConfigSchema = z.object({
  rateLimits: z.array(z.object({
    scope: z.string(),
    maxActions: z.number().int().positive(),
    windowMs: z.number().int().positive(),
  })),
  cooldowns: z.array(z.object({
    actionType: z.string(),
    cooldownMs: z.number().int().positive(),
    scope: z.string(),
  })),
  protectedEntities: z.array(z.object({
    entityType: z.string(),
    entityId: z.string(),
    reason: z.string(),
  })),
});
export type GuardrailConfig = z.infer<typeof GuardrailConfigSchema>;
