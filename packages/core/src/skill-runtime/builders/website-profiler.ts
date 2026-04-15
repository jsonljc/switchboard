import type { ParameterBuilder } from "../parameter-builder.js";

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;

function extractUrl(text: string): string {
  const match = text.match(URL_REGEX);
  return match ? match[0] : "";
}

export const websiteProfilerBuilder: ParameterBuilder = async (ctx, _config, _stores) => {
  const lastMessage = ctx.conversation?.messages?.at(-1);
  const url = extractUrl(lastMessage?.content ?? "");

  return {
    TARGET_URL: url,
    BUSINESS_NAME: ctx.persona.businessName,
    PERSONA_CONFIG: {
      tone: ctx.persona.tone,
      customInstructions: ctx.persona.customInstructions ?? "",
    },
  };
};
