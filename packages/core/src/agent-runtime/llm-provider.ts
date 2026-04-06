import type { LLMProvider } from "@switchboard/sdk";
import type { LLMAdapter, ConversationPrompt } from "../llm-adapter.js";
import type { ModelConfig } from "../model-router.js";
import type { Message } from "../conversation-store.js";

let messageCounter = 0;

function toConversationMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Message[] {
  return messages.map((msg) => ({
    id: `sdk-msg-${++messageCounter}`,
    contactId: "sdk-contact",
    direction: msg.role === "user" ? ("inbound" as const) : ("outbound" as const),
    content: msg.content,
    timestamp: new Date().toISOString(),
    channel: "dashboard" as const,
  }));
}

export class RuntimeLLMProvider implements LLMProvider {
  constructor(
    private adapter: LLMAdapter,
    private modelConfig?: ModelConfig,
  ) {}

  async chat(params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{ text: string }> {
    const prompt: ConversationPrompt = {
      systemPrompt: params.system,
      conversationHistory: toConversationMessages(params.messages),
      retrievedContext: [],
      agentInstructions: "",
    };

    const result = await this.adapter.generateReply(prompt, this.modelConfig);

    return { text: result.reply };
  }
}
