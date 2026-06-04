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

describe("COMMON_ESCALATION_TRIGGERS - anticoagulant_use (medical red-flag slice 2)", () => {
  it("fires on blood-thinner class terms alone (qualification-answer flow)", () => {
    expect(matchedIds("I'm on blood thinners, can I still get filler?")).toContain(
      "anticoagulant_use",
    );
    expect(matchedIds("im on blood thinners can i still get filler")).toContain(
      "anticoagulant_use",
    );
    expect(matchedIds("I take a blood-thinning medication")).toContain("anticoagulant_use");
    expect(matchedIds("I'm on anticoagulants")).toContain("anticoagulant_use");
  });

  it("fires on named anticoagulant drugs alone", () => {
    expect(matchedIds("yes, warfarin")).toContain("anticoagulant_use");
    expect(matchedIds("I'm on Eliquis for my heart")).toContain("anticoagulant_use");
    expect(matchedIds("taking Xarelto since my surgery in 2019")).toContain("anticoagulant_use");
    expect(matchedIds("I take clopidogrel")).toContain("anticoagulant_use");
  });

  it("fires on aspirin only in therapy phrasing", () => {
    expect(matchedIds("I'm on aspirin")).toContain("anticoagulant_use");
    expect(matchedIds("I take low-dose aspirin every morning")).toContain("anticoagulant_use");
    expect(matchedIds("I was prescribed baby aspirin")).toContain("anticoagulant_use");
  });

  it("stays silent on casual aspirin mentions", () => {
    expect(matchedIds("I took an aspirin for my headache yesterday")).not.toContain(
      "anticoagulant_use",
    );
    expect(matchedIds("do you sell aspirin?")).not.toContain("anticoagulant_use");
  });

  it("suppresses self-negations (incl. curly apostrophe)", () => {
    expect(matchedIds("I'm not on blood thinners")).not.toContain("anticoagulant_use");
    expect(matchedIds("I don't take warfarin")).not.toContain("anticoagulant_use");
    expect(matchedIds("I don’t take blood thinners")).not.toContain("anticoagulant_use");
    expect(matchedIds("never been on anticoagulants")).not.toContain("anticoagulant_use");
  });

  it("suppresses third-party attribution", () => {
    expect(matchedIds("my dad is on warfarin")).not.toContain("anticoagulant_use");
    expect(matchedIds("my mum takes blood thinners")).not.toContain("anticoagulant_use");
  });

  it("still fires on a genuine disclosure beside a negated one (per-match)", () => {
    expect(matchedIds("I'm not on aspirin but I do take warfarin daily")).toContain(
      "anticoagulant_use",
    );
  });

  it("does NOT suppress cessation (recent stop is still a clinician question)", () => {
    expect(matchedIds("I stopped warfarin last month")).toContain("anticoagulant_use");
    expect(matchedIds("my doctor took me off blood thinners recently")).toContain(
      "anticoagulant_use",
    );
  });
});
