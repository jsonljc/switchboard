import { describe, it, expect } from "vitest";
import { bookingFlow } from "../templates/booking.js";
import { qualificationFlow } from "../templates/qualification.js";
import { reviewRequestFlow } from "../templates/review-request.js";
import { objectionHandlingFlow } from "../templates/objection-handling.js";
import { postTreatmentFlow } from "../templates/post-treatment.js";
import type { ConversationFlowDefinition } from "../types.js";

function validateFlow(flow: ConversationFlowDefinition) {
  expect(flow.id).toBeTruthy();
  expect(flow.name).toBeTruthy();
  expect(flow.description).toBeTruthy();
  expect(flow.variables).toBeInstanceOf(Array);
  expect(flow.steps.length).toBeGreaterThan(0);

  const stepIds = new Set<string>();
  for (const step of flow.steps) {
    expect(step.id).toBeTruthy();
    expect(stepIds.has(step.id)).toBe(false);
    stepIds.add(step.id);

    // Validate step type
    expect([
      "message",
      "question",
      "branch",
      "wait",
      "action",
      "escalate",
      "score",
      "objection",
    ]).toContain(step.type);

    // Question steps must have options
    if (step.type === "question") {
      expect(step.options).toBeDefined();
      expect(step.options!.length).toBeGreaterThan(0);
    }

    // Branch steps must have branches
    if (step.type === "branch") {
      expect(step.branches).toBeDefined();
      expect(step.branches!.length).toBeGreaterThan(0);
    }

    // Action steps must have actionType
    if (step.type === "action") {
      expect(step.actionType).toBeTruthy();
    }

    // Escalate steps should have escalationReason
    if (step.type === "escalate") {
      expect(step.escalationReason).toBeTruthy();
    }
  }

  // Validate branch targets point to existing step IDs
  for (const step of flow.steps) {
    if (step.branches) {
      for (const branch of step.branches) {
        expect(stepIds.has(branch.targetStepId)).toBe(true);
      }
    }
    if (step.nextStepId) {
      expect(stepIds.has(step.nextStepId)).toBe(true);
    }
  }
}

describe("Conversation Templates", () => {
  describe("bookingFlow", () => {
    it("has valid structure", () => {
      validateFlow(bookingFlow);
    });

    it("has expected id and name", () => {
      expect(bookingFlow.id).toBe("booking");
      expect(bookingFlow.name).toBe("Appointment Booking");
    });

    it("declares required variables", () => {
      expect(bookingFlow.variables).toContain("patientName");
      expect(bookingFlow.variables).toContain("treatmentType");
    });

    it("includes a booking action step", () => {
      const actionStep = bookingFlow.steps.find((s) => s.type === "action");
      expect(actionStep).toBeDefined();
      expect(actionStep?.actionType).toBe("patient-engagement.appointment.book");
    });
  });

  describe("qualificationFlow", () => {
    it("has valid structure", () => {
      validateFlow(qualificationFlow);
    });

    it("has expected id", () => {
      expect(qualificationFlow.id).toBe("qualification");
    });

    it("includes branch logic for lead scoring", () => {
      const branchStep = qualificationFlow.steps.find((s) => s.type === "branch");
      expect(branchStep).toBeDefined();
      expect(branchStep?.branches).toBeDefined();
    });

    it("has a scoring step", () => {
      const scoreStep = qualificationFlow.steps.find((s) => s.type === "score");
      expect(scoreStep).toBeDefined();
    });
  });

  describe("reviewRequestFlow", () => {
    it("has valid structure", () => {
      validateFlow(reviewRequestFlow);
    });

    it("has expected id", () => {
      expect(reviewRequestFlow.id).toBe("review-request");
    });

    it("includes review request action", () => {
      const actionStep = reviewRequestFlow.steps.find((s) => s.type === "action");
      expect(actionStep?.actionType).toBe("patient-engagement.review.request");
    });
  });

  describe("objectionHandlingFlow", () => {
    it("has valid structure", () => {
      validateFlow(objectionHandlingFlow);
    });

    it("has expected id", () => {
      expect(objectionHandlingFlow.id).toBe("objection-handling");
    });

    it("includes an objection step", () => {
      const objStep = objectionHandlingFlow.steps.find((s) => s.type === "objection");
      expect(objStep).toBeDefined();
    });

    it("has escalation fallback", () => {
      const escStep = objectionHandlingFlow.steps.find((s) => s.type === "escalate");
      expect(escStep).toBeDefined();
      expect(escStep?.escalationReason).toContain("objection");
    });
  });

  describe("postTreatmentFlow", () => {
    it("has valid structure", () => {
      validateFlow(postTreatmentFlow);
    });

    it("has expected id", () => {
      expect(postTreatmentFlow.id).toBe("post-treatment");
    });

    it("includes satisfaction branch", () => {
      const branchStep = postTreatmentFlow.steps.find((s) => s.type === "branch");
      expect(branchStep).toBeDefined();
      expect(branchStep?.branches?.length).toBeGreaterThanOrEqual(2);
    });

    it("escalates for dissatisfied patients", () => {
      const escStep = postTreatmentFlow.steps.find((s) => s.type === "escalate");
      expect(escStep).toBeDefined();
      expect(escStep?.escalationReason).toContain("dissatisfaction");
    });

    it("includes review request action for satisfied patients", () => {
      const actionStep = postTreatmentFlow.steps.find((s) => s.type === "action");
      expect(actionStep?.actionType).toBe("patient-engagement.review.request");
    });
  });
});
