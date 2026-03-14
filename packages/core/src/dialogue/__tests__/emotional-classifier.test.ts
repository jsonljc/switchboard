import { describe, it, expect } from "vitest";
import { classifyEmotionalSignal } from "../emotional-classifier.js";

describe("classifyEmotionalSignal", () => {
  it("should detect positive valence", () => {
    const result = classifyEmotionalSignal({ message: "That's great, thank you!" });
    expect(result.valence).toBe("positive");
  });

  it("should detect negative valence", () => {
    const result = classifyEmotionalSignal({ message: "This is terrible service" });
    expect(result.valence).toBe("negative");
  });

  it("should detect price concern", () => {
    const result = classifyEmotionalSignal({ message: "How much does it cost?" });
    expect(result.concernType).toBe("price");
  });

  it("should detect fear concern", () => {
    const result = classifyEmotionalSignal({ message: "Will it hurt? I'm scared" });
    expect(result.concernType).toBe("fear");
  });

  it("should detect ready-now urgency", () => {
    const result = classifyEmotionalSignal({ message: "I need this done today" });
    expect(result.urgencySignal).toBe("ready_now");
  });

  it("should detect exploring urgency", () => {
    const result = classifyEmotionalSignal({ message: "Just browsing, curious about options" });
    expect(result.urgencySignal).toBe("exploring");
  });

  it("should detect Singlish markers", () => {
    const result = classifyEmotionalSignal({ message: "Can lah, how much ah?" });
    expect(result.localMarker).toBe("singlish");
  });

  it("should detect Malay markers", () => {
    const result = classifyEmotionalSignal({ message: "Boleh tanya berapa harga?" });
    expect(result.localMarker).toBe("malay_mix");
  });

  it("should detect Mandarin markers", () => {
    const result = classifyEmotionalSignal({ message: "请问价格多少？" });
    expect(result.localMarker).toBe("mandarin_mix");
  });

  it("should detect declining engagement", () => {
    const result = classifyEmotionalSignal({
      message: "ok",
      recentMessages: [
        {
          role: "user",
          text: "I'm very interested in teeth whitening and wanted to know all about it",
        },
        { role: "assistant", text: "Great question!" },
        { role: "user", text: "What about the process?" },
        { role: "assistant", text: "Sure, let me explain" },
        { role: "user", text: "ok" },
      ],
    });
    expect(result.engagement).toBe("declining");
  });

  it("should detect vague intent clarity", () => {
    const result = classifyEmotionalSignal({ message: "hmm" });
    expect(result.intentClarity).toBe("vague");
  });

  it("should detect confused intent clarity", () => {
    const result = classifyEmotionalSignal({ message: "What do you mean? I don't understand" });
    expect(result.intentClarity).toBe("confused");
  });

  it("should return higher confidence when more signals detected", () => {
    const simple = classifyEmotionalSignal({ message: "hi" });
    const rich = classifyEmotionalSignal({ message: "Can lah, how much? I need it now!" });
    expect(rich.confidence).toBeGreaterThan(simple.confidence);
  });
});
