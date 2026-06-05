import { z } from "zod";

/**
 * Per-deployment agent persona config. Lives at the top level of
 * AgentDeployment.inputConfig (businessName, tone, qualificationCriteria,
 * disqualificationCriteria, escalationRules, bookingLink, customInstructions).
 *
 * Distinct from the marketplace-side `AgentPersonaSchema` in
 * `./agent-persona.ts`, which models the full DB row (id, organizationId,
 * createdAt, …) and uses a tone enum + record-typed criteria. This schema
 * is the inputConfig-overlay variant — flatter, loose-typed criteria as
 * string arrays or object records, plain-string tone — matching the runtime `AgentPersona`
 * interface read by core skill builders (alex, sales-pipeline, etc.).
 *
 * The accessor `resolvePersona(inputConfig)` is intentionally lenient:
 * - returns `undefined` when `businessName` is missing or non-string
 *   (preserves the existing extractPersona contract — a deployment without
 *   a business name has no usable persona)
 * - defaults `tone` to "professional" when missing or non-string
 * - retains array OR object (record) criteria; drops primitive criteria (string/number/etc.)
 *
 * Mirrors the legacy `extractPersona` in
 * `packages/core/src/platform/prisma-deployment-resolver.ts:13-35`, EXCEPT it
 * intentionally preserves object/record criteria (the legacy dropped them to
 * undefined, which crashed prompt interpolation for object-shaped deployments).
 */
export const AgentPersonaConfigSchema = z.object({
  businessName: z.string(),
  tone: z.string(),
  qualificationCriteria: z
    .union([z.array(z.string()), z.record(z.string(), z.unknown())])
    .optional(),
  disqualificationCriteria: z
    .union([z.array(z.string()), z.record(z.string(), z.unknown())])
    .optional(),
  escalationRules: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
  bookingLink: z.string().optional(),
  customInstructions: z.string().optional(),
});

export type AgentPersonaConfig = z.infer<typeof AgentPersonaConfigSchema>;

export function resolvePersona(
  inputConfig: Record<string, unknown> | null | undefined,
): AgentPersonaConfig | undefined {
  if (!inputConfig || typeof inputConfig !== "object") return undefined;
  const businessName = inputConfig.businessName;
  if (typeof businessName !== "string") return undefined;

  const keepCriteria = (v: unknown): string[] | Record<string, unknown> | undefined =>
    Array.isArray(v) || (v !== null && typeof v === "object")
      ? (v as string[] | Record<string, unknown>)
      : undefined;

  return {
    businessName,
    tone: typeof inputConfig.tone === "string" ? inputConfig.tone : "professional",
    qualificationCriteria: keepCriteria(inputConfig.qualificationCriteria),
    disqualificationCriteria: keepCriteria(inputConfig.disqualificationCriteria),
    escalationRules: keepCriteria(inputConfig.escalationRules),
    bookingLink: typeof inputConfig.bookingLink === "string" ? inputConfig.bookingLink : undefined,
    customInstructions:
      typeof inputConfig.customInstructions === "string"
        ? inputConfig.customInstructions
        : undefined,
  };
}
