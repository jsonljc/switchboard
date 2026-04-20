import { describe, it, expect } from "vitest";
import { InterviewEngine } from "../interview-engine";
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
