import { describe, it, expect } from "vitest";
import { NaturalnessPacketAssembler } from "../naturalness-assembler.js";
import type { EmotionalSignal } from "../types.js";

const baseSignal: EmotionalSignal = {
  valence: "neutral",
  engagement: "medium",
  intentClarity: "clear",
  concernType: "none",
  urgencySignal: "none",
  localMarker: "none",
  confidence: 0.5,
};

describe("NaturalnessPacketAssembler", () => {
  const assembler = new NaturalnessPacketAssembler();

  it("should assemble a basic naturalness packet", () => {
    const packet = assembler.assemble({
      primaryMove: "greet",
      approvedContent: "Welcome!",
      emotionalSignal: baseSignal,
      sessionHistory: [],
      channel: "whatsapp",
      leadContext: { previousTurnCount: 0 },
    });

    expect(packet.primaryMove).toBe("greet");
    expect(packet.approvedContent).toBe("Welcome!");
    expect(packet.constraints.maxSentences).toBe(3); // WhatsApp limit
    expect(packet.constraints.maxWords).toBe(60);
  });

  it("should override to acknowledge_and_hold on declining engagement", () => {
    const result = assembler.applyEmotionalOverrides("ask_qualification_question", {
      ...baseSignal,
      engagement: "declining",
    });
    expect(result).toBe("acknowledge_and_hold");
  });

  it("should override to advance_to_booking on ready_now", () => {
    const result = assembler.applyEmotionalOverrides("ask_qualification_question", {
      ...baseSignal,
      urgencySignal: "ready_now",
    });
    expect(result).toBe("advance_to_booking");
  });

  it("should override to handle_objection on concern detected", () => {
    const result = assembler.applyEmotionalOverrides("ask_qualification_question", {
      ...baseSignal,
      concernType: "price",
    });
    expect(result).toBe("handle_objection");
  });

  it("should not override escalate_to_human", () => {
    const result = assembler.applyEmotionalOverrides("escalate_to_human", {
      ...baseSignal,
      engagement: "declining",
    });
    expect(result).toBe("escalate_to_human");
  });

  it("should apply localisation config", () => {
    const packet = assembler.assemble({
      primaryMove: "greet",
      approvedContent: "Hi",
      emotionalSignal: baseSignal,
      sessionHistory: [],
      channel: "telegram",
      leadContext: { previousTurnCount: 0 },
      localisationConfig: {
        market: "SG",
        naturalness: "casual",
        emoji: { allowed: true, maxPerMessage: 2, preferredSet: ["😊"] },
      },
    });

    expect(packet.voice.market).toBe("SG");
    expect(packet.voice.naturalness).toBe("casual");
    expect(packet.voice.emojiPolicy.allowed).toBe(true);
    expect(packet.constraints.maxSentences).toBe(4); // Telegram
  });

  it("should include forbidden phrases", () => {
    const packet = assembler.assemble({
      primaryMove: "greet",
      approvedContent: "Hi",
      emotionalSignal: baseSignal,
      sessionHistory: [],
      channel: "web_chat",
      leadContext: { previousTurnCount: 0 },
      forbiddenPhrases: ["test phrase"],
    });

    expect(packet.constraints.forbiddenPhrases).toContain("test phrase");
  });
});
