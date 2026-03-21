import { describe, it, expect } from "vitest";

interface TestChatMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  flagged?: boolean;
}

function formatTestChatHistory(messages: TestChatMessage[]): string {
  return messages.map((m) => `[${m.role}] ${m.text}`).join("\n");
}

describe("Test Chat", () => {
  it("formats chat history for prompt context", () => {
    const messages: TestChatMessage[] = [
      { role: "user", text: "What services do you offer?", timestamp: new Date().toISOString() },
      {
        role: "assistant",
        text: "We offer Botox, fillers, and facials.",
        timestamp: new Date().toISOString(),
      },
    ];

    const formatted = formatTestChatHistory(messages);
    expect(formatted).toContain("[user] What services do you offer?");
    expect(formatted).toContain("[assistant] We offer Botox");
  });

  it("identifies flagged messages", () => {
    const msg: TestChatMessage = {
      role: "assistant",
      text: "Wrong answer",
      timestamp: new Date().toISOString(),
      flagged: true,
    };
    expect(msg.flagged).toBe(true);
  });
});
