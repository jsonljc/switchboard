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

describe("COMMON_ESCALATION_TRIGGERS - suspicious_lesion (medical red-flag slice 2)", () => {
  it("fires on lesion noun + change qualifier (both orders)", () => {
    expect(matchedIds("I have a mole that's been getting darker")).toContain("suspicious_lesion");
    expect(matchedIds("my mole is changing")).toContain("suspicious_lesion");
    expect(matchedIds("there's a dark patch that keeps growing")).toContain("suspicious_lesion");
    expect(matchedIds("a suspicious mole on my cheek")).toContain("suspicious_lesion");
    expect(matchedIds("I'm worried about a changing mole")).toContain("suspicious_lesion");
    expect(matchedIds("my mole started bleeding")).toContain("suspicious_lesion");
    expect(matchedIds("ive got a weird looking mole can you laser it off")).toContain(
      "suspicious_lesion",
    );
  });

  it("fires on a new mole and non-healing sores", () => {
    expect(matchedIds("a new mole appeared on my arm")).toContain("suspicious_lesion");
    expect(matchedIds("I have a sore that won't heal")).toContain("suspicious_lesion");
  });

  it("fires on explicit melanoma worry", () => {
    expect(matchedIds("could this be melanoma?")).toContain("suspicious_lesion");
  });

  it("stays silent on routine mole-removal and pigmentation requests", () => {
    expect(matchedIds("can you remove a mole?")).not.toContain("suspicious_lesion");
    expect(matchedIds("I want my moles removed")).not.toContain("suspicious_lesion");
    expect(matchedIds("do you treat dark spots from acne?")).not.toContain("suspicious_lesion");
    expect(matchedIds("my acne marks are getting darker")).not.toContain("suspicious_lesion");
    expect(matchedIds("melasma patches on my cheeks")).not.toContain("suspicious_lesion");
    expect(matchedIds("price for pigmentation removal?")).not.toContain("suspicious_lesion");
    expect(matchedIds("I have a new spot from a breakout")).not.toContain("suspicious_lesion");
    // Review pin: "weird" qualifier + pimple context must stay suppressed by the
    // acne/breakout negation (the negation span overlaps the "weird spot" occurrence).
    expect(matchedIds("I have a weird spot from a pimple")).not.toContain("suspicious_lesion");
  });

  it("suppresses stable/unchanged disclosures and third-party lesions", () => {
    expect(matchedIds("my mole hasn't changed in years")).not.toContain("suspicious_lesion");
    expect(matchedIds("my mum has a weird mole")).not.toContain("suspicious_lesion");
  });
});

describe("COMMON_ESCALATION_TRIGGERS - recent_procedure (medical red-flag slice 2)", () => {
  it("fires on just/recently + surgical noun", () => {
    expect(matchedIds("I just had a facelift, is HIFU ok?")).toContain("recent_procedure");
    expect(matchedIds("recently underwent surgery on my jaw")).toContain("recent_procedure");
    expect(matchedIds("i just got a nose job")).toContain("recent_procedure");
  });

  it("fires on surgical noun + recency marker", () => {
    expect(matchedIds("I had liposuction 3 weeks ago")).toContain("recent_procedure");
    expect(matchedIds("rhinoplasty last month, can I do laser?")).toContain("recent_procedure");
    expect(matchedIds("I had an operation on my nose two weeks ago")).toContain("recent_procedure");
    expect(matchedIds("had surgery yesterday")).toContain("recent_procedure");
  });

  it("fires on healing-state disclosures", () => {
    expect(matchedIds("I'm two weeks post-op")).toContain("recent_procedure");
    expect(matchedIds("still have stitches from my tummy tuck")).toContain("recent_procedure");
    expect(matchedIds("I'm still recovering from surgery")).toContain("recent_procedure");
  });

  it("stays silent on future/desire phrasing", () => {
    expect(matchedIds("I want a nose job")).not.toContain("recent_procedure");
    expect(matchedIds("thinking about a facelift next year")).not.toContain("recent_procedure");
    expect(matchedIds("I'm considering surgery next month")).not.toContain("recent_procedure");
  });

  it("stays silent on routine clinic treatments and old surgery", () => {
    expect(matchedIds("I had botox 2 weeks ago, want a top-up")).not.toContain("recent_procedure");
    expect(matchedIds("I had a facial last week")).not.toContain("recent_procedure");
    expect(matchedIds("I had surgery in 2019")).not.toContain("recent_procedure");
    expect(matchedIds("my surgery was ten years ago")).not.toContain("recent_procedure");
  });

  it("suppresses negations and third-party surgery", () => {
    expect(matchedIds("I haven't had any surgery, just botox last week")).not.toContain(
      "recent_procedure",
    );
    expect(matchedIds("no surgery last month, only facials")).not.toContain("recent_procedure");
    expect(matchedIds("my sister had a facelift last month")).not.toContain("recent_procedure");
  });
});
