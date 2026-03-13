import { describe, it, expect } from "vitest";
import { computeRiskInput } from "../categories.js";

describe("computeRiskInput", () => {
  describe("read/diagnostic actions", () => {
    it("should return none risk for lead.score", () => {
      const risk = computeRiskInput("customer-engagement.lead.score", {});
      expect(risk.baseRisk).toBe("none");
      expect(risk.reversibility).toBe("full");
    });

    it("should return none risk for pipeline.diagnose", () => {
      const risk = computeRiskInput("customer-engagement.pipeline.diagnose", {});
      expect(risk.baseRisk).toBe("none");
    });

    it("should return none risk for contact.score_ltv", () => {
      const risk = computeRiskInput("customer-engagement.contact.score_ltv", {});
      expect(risk.baseRisk).toBe("none");
    });
  });

  describe("low-risk actions", () => {
    it("should return low risk for lead.qualify", () => {
      const risk = computeRiskInput("customer-engagement.lead.qualify", {});
      expect(risk.baseRisk).toBe("low");
    });

    it("should return low risk for journey.update_stage", () => {
      const risk = computeRiskInput("customer-engagement.journey.update_stage", {});
      expect(risk.baseRisk).toBe("low");
    });

    it("should return low risk for conversation.escalate", () => {
      const risk = computeRiskInput("customer-engagement.conversation.escalate", {});
      expect(risk.baseRisk).toBe("low");
    });

    it("should return low risk for conversation.handle_objection", () => {
      const risk = computeRiskInput("customer-engagement.conversation.handle_objection", {});
      expect(risk.baseRisk).toBe("low");
    });
  });

  describe("outbound communication", () => {
    it("should return low risk with no reversibility for reminder.send", () => {
      const risk = computeRiskInput("customer-engagement.reminder.send", {});
      expect(risk.baseRisk).toBe("low");
      expect(risk.reversibility).toBe("none");
    });

    it("should return low risk for review.request", () => {
      const risk = computeRiskInput("customer-engagement.review.request", {});
      expect(risk.baseRisk).toBe("low");
      expect(risk.reversibility).toBe("none");
    });
  });

  describe("appointment management", () => {
    it("should return medium risk for appointment.book", () => {
      const risk = computeRiskInput("customer-engagement.appointment.book", { serviceValue: 500 });
      expect(risk.baseRisk).toBe("medium");
      expect(risk.exposure.dollarsAtRisk).toBe(500);
      expect(risk.reversibility).toBe("full");
    });

    it("should default serviceValue to 200", () => {
      const risk = computeRiskInput("customer-engagement.appointment.book", {});
      expect(risk.exposure.dollarsAtRisk).toBe(200);
    });

    it("should return medium risk for appointment.cancel", () => {
      const risk = computeRiskInput("customer-engagement.appointment.cancel", {});
      expect(risk.baseRisk).toBe("medium");
    });

    it("should return medium risk for appointment.reschedule", () => {
      const risk = computeRiskInput("customer-engagement.appointment.reschedule", {});
      expect(risk.baseRisk).toBe("medium");
    });
  });

  describe("public-facing responses", () => {
    it("should return high risk for review.respond", () => {
      const risk = computeRiskInput("customer-engagement.review.respond", {});
      expect(risk.baseRisk).toBe("high");
      expect(risk.exposure.blastRadius).toBe(100);
      expect(risk.reversibility).toBe("none");
    });
  });

  describe("treatment logging", () => {
    it("should return medium risk with value exposure", () => {
      const risk = computeRiskInput("customer-engagement.treatment.log", { value: 300 });
      expect(risk.baseRisk).toBe("medium");
      expect(risk.exposure.dollarsAtRisk).toBe(300);
    });
  });

  describe("cadence management", () => {
    it("should return low risk for cadence.start", () => {
      const risk = computeRiskInput("customer-engagement.cadence.start", {});
      expect(risk.baseRisk).toBe("low");
      expect(risk.reversibility).toBe("full");
    });

    it("should return low risk for cadence.stop", () => {
      const risk = computeRiskInput("customer-engagement.cadence.stop", {});
      expect(risk.baseRisk).toBe("low");
    });
  });

  describe("unknown action", () => {
    it("should default to low risk", () => {
      const risk = computeRiskInput("unknown.action.type", {});
      expect(risk.baseRisk).toBe("low");
    });
  });
});
