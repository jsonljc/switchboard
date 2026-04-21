import { describe, it, expect } from "vitest";
import { InterviewEngine, type InterviewQuestion } from "../interview-engine";
import { createEmptyPlaybook } from "@switchboard/schemas";

describe("InterviewEngine", () => {
  it("returns business identity question for empty playbook", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question = engine.getNextQuestion();
    expect(question).not.toBeNull();
    expect(question!.targetSection).toBe("businessIdentity");
  });

  it("skips sections that are already ready", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.businessIdentity.name = "Test Biz";
    const engine = new InterviewEngine(playbook);
    const question = engine.getNextQuestion();
    expect(question!.targetSection).toBe("services");
  });

  it("asks confirmation for check_this sections", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "check_this";
    playbook.businessIdentity.name = "Bright Smile Dental";
    const engine = new InterviewEngine(playbook);
    const question = engine.getNextQuestion();
    expect(question!.type).toBe("confirm");
    expect(question!.targetSection).toBe("businessIdentity");
  });

  it("returns null when all required sections are ready", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.businessIdentity.name = "Test";
    playbook.services = [
      { id: "1", name: "Test", bookingBehavior: "ask_first", status: "ready", source: "manual" },
    ];
    playbook.hours.status = "ready";
    playbook.bookingRules.status = "ready";
    playbook.approvalMode.status = "ready";
    playbook.escalation.status = "ready";
    playbook.channels.status = "ready";
    const engine = new InterviewEngine(playbook);
    const question = engine.getNextQuestion();
    expect(question).toBeNull();
  });

  it("generates category-seeded questions when category is provided", () => {
    const playbook = createEmptyPlaybook();
    const engine = new InterviewEngine(playbook, "dental");
    const question = engine.getNextQuestion();
    expect(question!.contextHint).toContain("dental");
  });

  it("processes user response and returns playbook update", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question = engine.getNextQuestion()!;
    const update = engine.processResponse(
      question,
      "Bright Smile Dental, a dental clinic in Singapore",
    );
    expect(update.section).toBe("businessIdentity");
    expect(update.fields).toBeDefined();
  });
});

describe("processResponse — real parsing", () => {
  it("extracts business name from identity question response", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-businessIdentity",
      targetSection: "businessIdentity",
      type: "ask",
      prompt: "What's your business called?",
      contextHint: "",
    };
    const result = engine.processResponse(
      question,
      "We're Bright Smile Dental, a dental clinic in Orchard Road",
    );
    expect(result.fields).toHaveProperty("name", "Bright Smile Dental");
    expect(result.newStatus).toBe("check_this");
  });

  it("extracts services from services question response", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-services",
      targetSection: "services",
      type: "ask",
      prompt: "What services do you offer?",
      contextHint: "",
    };
    const result = engine.processResponse(
      question,
      "Teeth whitening $450, cleaning $80, Invisalign $150",
    );
    const services = result.fields.services as Array<{ name: string; price?: number }>;
    expect(services.length).toBe(3);
    expect(services[0].name).toBe("Teeth whitening");
    expect(services[0].price).toBe(450);
  });

  it("stores raw text in unparsedInput for hours", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-hours",
      targetSection: "hours",
      type: "ask",
      prompt: "What are your hours?",
      contextHint: "",
    };
    const result = engine.processResponse(question, "Monday to Friday 9am to 6pm");
    expect(result.fields).toHaveProperty("unparsedInput", "Monday to Friday 9am to 6pm");
    expect(result.newStatus).toBe("check_this");
  });

  it("stores raw text for booking rules as leadVsBooking", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-bookingRules",
      targetSection: "bookingRules",
      type: "ask",
      prompt: "How do you handle bookings?",
      contextHint: "",
    };
    const result = engine.processResponse(question, "Qualify first then book");
    expect(result.fields).toHaveProperty("leadVsBooking", "Qualify first then book");
    expect(result.newStatus).toBe("check_this");
  });

  it("extracts escalation triggers from comma-separated list", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-escalation",
      targetSection: "escalation",
      type: "ask",
      prompt: "What should Alex escalate?",
      contextHint: "",
    };
    const result = engine.processResponse(question, "refund, complaint, legal");
    expect(result.fields.triggers).toEqual(["refund", "complaint", "legal"]);
    expect(result.newStatus).toBe("check_this");
  });

  it("preserves unparsedInput for sections without structured parsers", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-approvalMode",
      targetSection: "approvalMode",
      type: "ask",
      prompt: "How much autonomy?",
      contextHint: "",
    };
    const result = engine.processResponse(question, "Ask me before booking anything");
    expect(result.fields).toHaveProperty("unparsedInput", "Ask me before booking anything");
    expect(result.newStatus).toBe("check_this");
  });
});
