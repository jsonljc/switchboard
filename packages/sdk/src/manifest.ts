import { z } from "zod";

export const CapabilityType = z.enum(["chat", "browser", "file_system", "screen_control", "api"]);
export type CapabilityType = z.infer<typeof CapabilityType>;

export const PricingModel = z.enum(["free", "paid", "usage_based"]);
export type PricingModel = z.infer<typeof PricingModel>;

export const ConnectionRequirementSchema = z.object({
  type: z.string(),
  reason: z.string(),
});
export type ConnectionRequirement = z.infer<typeof ConnectionRequirementSchema>;

export const AgentManifestSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1),
  category: z.string().min(1),

  capabilities: z
    .object({
      required: z.array(CapabilityType).default([]),
      optional: z.array(CapabilityType).default([]),
    })
    .default({ required: [], optional: [] }),

  connections: z
    .object({
      required: z.array(ConnectionRequirementSchema).default([]),
      optional: z.array(ConnectionRequirementSchema).default([]),
    })
    .default({ required: [], optional: [] }),

  governance: z
    .object({
      startingAutonomy: z.enum(["supervised", "guided", "autonomous"]).default("supervised"),
      escalateWhen: z.array(z.string()).default([]),
    })
    .default({ startingAutonomy: "supervised", escalateWhen: [] }),

  pricing: z
    .object({
      model: PricingModel.default("free"),
      priceMonthly: z.number().optional(),
      pricePerTask: z.number().optional(),
    })
    .default({ model: "free" }),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;
