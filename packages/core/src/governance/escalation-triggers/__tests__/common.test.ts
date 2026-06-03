import { describe, it, expect } from "vitest";
import { COMMON_ESCALATION_TRIGGERS } from "../common.js";
import { scanForEscalationTriggers } from "../../scanner/escalation-trigger-scanner.js";

function matchedIds(text: string): string[] {
  return scanForEscalationTriggers(text, COMMON_ESCALATION_TRIGGERS).map((m) => m.entry.id);
}

describe("COMMON_ESCALATION_TRIGGERS — T1.2a bare anxiety narrowing", () => {
  it("does NOT escalate bare aesthetic anxiety (the designed objection)", () => {
    expect(matchedIds("I'm so anxious about how my results will look")).not.toContain(
      "sensitive_keyword_mental_health",
    );
    expect(matchedIds("a bit nervous and anxious about the downtime")).not.toContain(
      "sensitive_keyword_mental_health",
    );
  });

  it("STILL escalates genuine mental-health crisis signals", () => {
    expect(matchedIds("I have an anxiety disorder")).toContain("sensitive_keyword_mental_health");
    expect(matchedIds("I get panic attacks")).toContain("sensitive_keyword_mental_health");
    expect(matchedIds("I feel suicidal")).toContain("sensitive_keyword_mental_health");
    expect(matchedIds("I struggle with depression")).toContain("sensitive_keyword_mental_health");
    expect(matchedIds("I have a history of anxiety")).toContain("sensitive_keyword_mental_health");
    expect(matchedIds("I've been dealing with anxiety every day")).toContain(
      "sensitive_keyword_mental_health",
    );
  });
});

describe("COMMON_ESCALATION_TRIGGERS — T1.2b negation / third-party guards", () => {
  it("does NOT escalate a self-negated condition", () => {
    expect(matchedIds("I'm not diabetic")).not.toContain("sensitive_keyword_medical_condition");
    expect(matchedIds("I don't have diabetes")).not.toContain(
      "sensitive_keyword_medical_condition",
    );
    expect(matchedIds("I have no history of cancer")).not.toContain(
      "sensitive_keyword_medical_condition",
    );
  });

  it("does NOT escalate a third-party (family) condition", () => {
    expect(matchedIds("my mum had cancer")).not.toContain("sensitive_keyword_medical_condition");
    expect(matchedIds("my mother has diabetes")).not.toContain(
      "sensitive_keyword_medical_condition",
    );
  });

  it("STILL escalates a genuine first-person condition", () => {
    expect(matchedIds("I have diabetes")).toContain("sensitive_keyword_medical_condition");
    expect(matchedIds("I'm diabetic, can I get filler?")).toContain(
      "sensitive_keyword_medical_condition",
    );
    expect(matchedIds("I have cancer")).toContain("sensitive_keyword_medical_condition");
  });

  it("scans per-sentence: a first-person condition in its own sentence still escalates", () => {
    expect(matchedIds("My mum had cancer. I have diabetes too.")).toContain(
      "sensitive_keyword_medical_condition",
    );
  });

  it("does NOT escalate a declined treatment combo", () => {
    expect(matchedIds("I'd rather not combine botox and filler")).not.toContain(
      "multi_treatment_combo",
    );
  });

  it("STILL escalates a genuine treatment-combo question", () => {
    expect(matchedIds("can I combine botox and filler the same day?")).toContain(
      "multi_treatment_combo",
    );
  });
});

describe("COMMON_ESCALATION_TRIGGERS — T1.5 self-disclosed minor", () => {
  it("escalates a self-disclosed minor", () => {
    expect(matchedIds("hi I'm 16, can I get fillers?")).toContain("sensitive_keyword_minor");
    expect(matchedIds("I am 15 and want botox")).toContain("sensitive_keyword_minor");
    expect(matchedIds("im 14 is that ok")).toContain("sensitive_keyword_minor");
    expect(matchedIds("I'm a minor")).toContain("sensitive_keyword_minor");
    expect(matchedIds("I'm 16yo")).toContain("sensitive_keyword_minor");
    // curly apostrophe (mobile autocorrect) must still match
    expect(matchedIds("I’m 16, can I get fillers?")).toContain("sensitive_keyword_minor");
    // recent birthday => currently a minor
    expect(matchedIds("I turned 17 last week")).toContain("sensitive_keyword_minor");
    expect(matchedIds("I just turned 16")).toContain("sensitive_keyword_minor");
  });

  it("still escalates the existing third-party minor phrasing", () => {
    expect(matchedIds("my daughter is interested")).toContain("sensitive_keyword_minor");
  });

  it("is precise: does NOT fire on adult / non-age uses of the number", () => {
    expect(matchedIds("I have 16 years of experience with botox")).not.toContain(
      "sensitive_keyword_minor",
    );
    expect(matchedIds("I'm 160cm tall")).not.toContain("sensitive_keyword_minor");
    expect(matchedIds("I'm 16 weeks pregnant")).not.toContain("sensitive_keyword_minor");
    expect(matchedIds("I'm 18, can I book?")).not.toContain("sensitive_keyword_minor");
    expect(matchedIds("I lost 16 pounds recently")).not.toContain("sensitive_keyword_minor");
    expect(matchedIds("I was 16 when I started coming here")).not.toContain(
      "sensitive_keyword_minor",
    );
    expect(matchedIds("I just turned 18 yesterday")).not.toContain("sensitive_keyword_minor");
  });
});
