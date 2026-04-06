import type { AgentHandler } from "@switchboard/sdk";
import { assembleSystemPrompt } from "./system-prompt-assembler.js";

export const DefaultChatHandler: AgentHandler = {
  async onMessage(ctx) {
    const systemPrompt = assembleSystemPrompt(ctx.persona);
    const messages = (ctx.conversation?.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response = await ctx.llm.chat({
      system: systemPrompt,
      messages,
    });

    await ctx.chat.send(response.text);
  },
};
