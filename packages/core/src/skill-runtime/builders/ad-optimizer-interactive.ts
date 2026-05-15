import { resolveAdOptimizerConfig } from "@switchboard/schemas";

import type { ParameterBuilder } from "../parameter-builder.js";

/**
 * Interactive parameter builder for the Ad Optimizer skill.
 *
 * Unlike the batch builder (which pre-fetches all campaign data from APIs),
 * this builder provides only deployment configuration. The LLM uses
 * ads-analytics tools at runtime to fetch and analyze campaign data
 * based on the user's conversational request.
 */
export const adOptimizerInteractiveBuilder: ParameterBuilder = async (ctx, _config, _stores) => {
  const adConfig = resolveAdOptimizerConfig(ctx.deployment?.inputConfig);

  return {
    BUSINESS_NAME: ctx.persona.businessName,
    DEPLOYMENT_CONFIG: adConfig,
    PERSONA_CONFIG: {
      tone: ctx.persona.tone,
      customInstructions: ctx.persona.customInstructions ?? "",
    },
  };
};
