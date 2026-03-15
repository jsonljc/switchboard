import { describe, it, expect } from "vitest";
import { MessageIntentClassifier } from "../intent-classifier.js";

describe("MessageIntentClassifier", () => {
  const classifier = new MessageIntentClassifier();

  describe("empty / whitespace input", () => {
    it("returns off_topic with 0 confidence for empty string", () => {
      const result = classifier.classify("");
      expect(result.intent).toBe("off_topic");
      expect(result.confidence).toBe(0);
    });

    it("returns off_topic for whitespace-only input", () => {
      const result = classifier.classify("   ");
      expect(result.intent).toBe("off_topic");
      expect(result.confidence).toBe(0);
    });
  });

  describe("option_selection", () => {
    it("classifies a single digit as option_selection", () => {
      const result = classifier.classify("3");
      expect(result.intent).toBe("option_selection");
      expect(result.selectedOption).toBe(3);
      expect(result.confidence).toBe(0.85);
    });

    it("classifies multi-digit number", () => {
      const result = classifier.classify("12");
      expect(result.intent).toBe("option_selection");
      expect(result.selectedOption).toBe(12);
    });
  });

  describe("affirmative", () => {
    const affirm = [
      "yes",
      "yeah",
      "yep",
      "yup",
      "sure",
      "ok",
      "okay",
      "absolutely",
      "definitely",
      "of course",
      "sounds good",
      "let's do it",
      "go ahead",
      "please",
    ];
    for (const word of affirm) {
      it(`classifies "${word}" as affirmative`, () => {
        expect(classifier.classify(word).intent).toBe("affirmative");
      });
    }

    it("is case-insensitive", () => {
      expect(classifier.classify("YES").intent).toBe("affirmative");
      expect(classifier.classify("Ok").intent).toBe("affirmative");
    });

    it("allows trailing period", () => {
      expect(classifier.classify("yes.").intent).toBe("affirmative");
    });
  });

  describe("negative", () => {
    const negative = [
      "no",
      "nope",
      "nah",
      "not interested",
      "not now",
      "maybe later",
      "pass",
      "skip",
      "cancel",
    ];
    for (const word of negative) {
      it(`classifies "${word}" as negative`, () => {
        expect(classifier.classify(word).intent).toBe("negative");
      });
    }
  });

  describe("escalation_request", () => {
    it("detects 'speak to a human'", () => {
      expect(classifier.classify("speak to a human").intent).toBe("escalation_request");
    });

    it("detects 'talk with a real person'", () => {
      expect(classifier.classify("I want a real person").intent).toBe("escalation_request");
    });

    it("detects standalone 'agent'", () => {
      expect(classifier.classify("agent").intent).toBe("escalation_request");
    });

    it("detects 'I need a real person'", () => {
      expect(classifier.classify("I need a real person").intent).toBe("escalation_request");
    });

    it("detects 'connect with a doctor'", () => {
      expect(classifier.classify("connect with a doctor").intent).toBe("escalation_request");
    });

    it("detects 'are you a bot'", () => {
      expect(classifier.classify("are you a bot").intent).toBe("escalation_request");
    });

    it("detects 'is this automated'", () => {
      expect(classifier.classify("is this automated").intent).toBe("escalation_request");
    });

    it("detects 'not a bot'", () => {
      expect(classifier.classify("you're not a bot right").intent).toBe("escalation_request");
    });

    it("detects standalone 'call me' as escalation", () => {
      expect(classifier.classify("call me").intent).toBe("escalation_request");
    });

    it("does not classify 'call me at [number]' as escalation", () => {
      expect(classifier.classify("call me at 555-123-4567").intent).not.toBe("escalation_request");
    });
  });

  describe("medical_risk", () => {
    it("detects pregnancy mention", () => {
      expect(classifier.classify("I'm pregnant, is this safe?").intent).toBe("medical_risk");
    });

    it("detects medication mention", () => {
      expect(classifier.classify("I'm on medication for my heart").intent).toBe("medical_risk");
    });

    it("detects autoimmune mention", () => {
      expect(classifier.classify("I have an autoimmune condition").intent).toBe("medical_risk");
    });

    it("detects recent surgery", () => {
      expect(classifier.classify("I just had surgery last week").intent).toBe("medical_risk");
    });

    it("detects allergic reaction concern", () => {
      expect(classifier.classify("I had an allergic reaction before").intent).toBe("medical_risk");
    });

    it("detects dosage questions", () => {
      expect(classifier.classify("how many units of botox do I need").intent).toBe("medical_risk");
    });

    it("detects diagnosis requests", () => {
      expect(classifier.classify("can you diagnose my issue").intent).toBe("medical_risk");
    });
  });

  describe("objection", () => {
    it("detects 'too expensive'", () => {
      expect(classifier.classify("too expensive").intent).toBe("objection");
    });

    it("detects 'I'm worried about side effects'", () => {
      expect(classifier.classify("I'm worried about side effects").intent).toBe("objection");
    });

    it("detects 'how much does it cost'", () => {
      expect(classifier.classify("how much does it cost").intent).toBe("objection");
    });

    it("detects 'what about risks'", () => {
      expect(classifier.classify("what about risks").intent).toBe("objection");
    });

    it("detects 'recovery time'", () => {
      expect(classifier.classify("recovery time after treatment").intent).toBe("objection");
    });
  });

  describe("question", () => {
    it("detects questions starting with question words", () => {
      expect(classifier.classify("What time is my appointment?").intent).toBe("question");
      expect(classifier.classify("When can I come in?").intent).toBe("question");
      expect(classifier.classify("How do I prepare?").intent).toBe("question");
    });

    it("detects questions ending with ?", () => {
      expect(classifier.classify("Is this covered by insurance?").intent).toBe("question");
    });
  });

  describe("freeform_answer", () => {
    it("detects date references", () => {
      expect(classifier.classify("tomorrow").intent).toBe("freeform_answer");
      expect(classifier.classify("next Monday").intent).toBe("freeform_answer");
    });

    it("detects time references", () => {
      expect(classifier.classify("3pm").intent).toBe("freeform_answer");
      expect(classifier.classify("10:30").intent).toBe("freeform_answer");
    });

    it("detects name introduction", () => {
      const result = classifier.classify("my name is Sarah");
      expect(result.intent).toBe("freeform_answer");
      expect(result.extractedData).toEqual({ name: "Sarah" });
    });

    it("extracts email", () => {
      const result = classifier.classify("my email is jane@example.com");
      expect(result.intent).toBe("freeform_answer");
      expect(result.extractedData?.["email"]).toBe("jane@example.com");
    });

    it("extracts phone number", () => {
      const result = classifier.classify("call me at 555-123-4567");
      expect(result.intent).toBe("freeform_answer");
      expect(result.extractedData?.["phone"]).toMatch(/555-123-4567/);
    });
  });

  describe("fallback behavior", () => {
    it("classifies short unmatched text as freeform_answer with low confidence", () => {
      const result = classifier.classify("hello there");
      expect(result.intent).toBe("freeform_answer");
      expect(result.confidence).toBe(0.5);
    });

    it("classifies long unmatched text as off_topic with low confidence", () => {
      const longText = "a".repeat(101);
      const result = classifier.classify(longText);
      expect(result.intent).toBe("off_topic");
      expect(result.confidence).toBe(0.3);
    });
  });
});
