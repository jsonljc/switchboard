import { z } from "zod";
import { AgentCheckpointSchema } from "@switchboard/schemas";

/**
 * Ad-operator specific checkpoint extensions.
 * The base AgentCheckpointSchema is extended with domain-specific fields
 * that help the agent resume with full context.
 */
export const AdOperatorCheckpointSchema = AgentCheckpointSchema.extend({
  extensions: z
    .object({
      /** Campaign IDs being actively managed this session */
      activeCampaignIds: z.array(z.string()).optional(),
      /** Current optimization focus (budget, targeting, creative) */
      optimizationFocus: z.string().optional(),
      /** Platform being operated on (meta, google, tiktok) */
      currentPlatform: z.string().optional(),
    })
    .optional(),
});

export default AdOperatorCheckpointSchema;
