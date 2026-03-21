import { describe, it, expect } from "vitest";
import { buildConversationPrompt } from "../prompt-builder.js";
import type { Message } from "@switchboard/core";
import type { RetrievedChunk } from "@switchboard/core";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    contactId: "c1",
    direction: "inbound",
    content: "Hello",
    timestamp: new Date().toISOString(),
    channel: "whatsapp",
    ...overrides,
  };
}

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    content: "We offer Botox treatments starting at $200",
    sourceType: "document",
    similarity: 0.85,
    ...overrides,
  };
}

describe("buildConversationPrompt", () => {
  it("builds prompt with default tone and language", () => {
    const prompt = buildConversationPrompt({
      history: [makeMessage()],
      chunks: [makeChunk()],
      tonePreset: undefined,
      language: undefined,
    });

    expect(prompt.systemPrompt).toContain("receptionist"); // warm-professional default
    expect(prompt.systemPrompt).toContain("English"); // en default
    expect(prompt.conversationHistory).toHaveLength(1);
    expect(prompt.retrievedContext).toHaveLength(1);
    expect(prompt.agentInstructions).toContain("Lead Responder");
  });

  it("uses specified tone preset", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: "casual-conversational",
      language: undefined,
    });

    expect(prompt.systemPrompt).toContain("friend");
    expect(prompt.systemPrompt).toContain("texting");
  });

  it("uses specified language", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: "zh",
    });

    expect(prompt.systemPrompt).toContain("Mandarin");
  });

  it("includes agent instructions about qualification signals", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
    });

    expect(prompt.agentInstructions).toContain("qualification");
    expect(prompt.agentInstructions).toContain("escalate");
  });

  it("includes booking link in instructions when provided", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      bookingLink: "https://calendly.com/medspa",
    });

    expect(prompt.agentInstructions).toContain("https://calendly.com/medspa");
  });

  it("includes test mode instructions when testMode is true", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      testMode: true,
    });

    expect(prompt.agentInstructions).toContain("test mode");
  });
});
