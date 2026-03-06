import { describe, it, expect } from "vitest";
import { ResponseHumanizer } from "../composer/humanize.js";

describe("ResponseHumanizer", () => {
  describe("applyTerminology", () => {
    it("replaces terms case-insensitively with word boundaries", () => {
      const h = new ResponseHumanizer({ campaign: "treatment plan" });
      expect(h.applyTerminology("Campaign paused")).toBe("treatment plan paused");
      expect(h.applyTerminology("CAMPAIGN paused")).toBe("treatment plan paused");
    });

    it("preserves plurals", () => {
      const h = new ResponseHumanizer({ campaign: "treatment plan" });
      expect(h.applyTerminology("All campaigns paused")).toBe("All treatment plans paused");
    });

    it("does not replace partial word matches", () => {
      const h = new ResponseHumanizer({ campaign: "treatment plan" });
      expect(h.applyTerminology("campaigning for office")).toBe("campaigning for office");
    });

    it("replaces multiple different terms", () => {
      const h = new ResponseHumanizer({
        campaign: "treatment plan",
        budget: "spending limit",
      });
      expect(h.applyTerminology("Set campaign budget to $500")).toBe(
        "Set treatment plan spending limit to $500",
      );
    });

    it("handles longer terms before shorter ones", () => {
      const h = new ResponseHumanizer({
        campaign: "plan",
        "campaign budget": "plan spending limit",
      });
      expect(h.applyTerminology("Set campaign budget")).toBe("Set plan spending limit");
    });

    it("returns text unchanged with empty terminology", () => {
      const h = new ResponseHumanizer({});
      expect(h.applyTerminology("Campaign paused")).toBe("Campaign paused");
    });

    it("handles special regex characters in terms", () => {
      const h = new ResponseHumanizer({ "cost+revenue": "money" });
      expect(h.applyTerminology("Check cost+revenue")).toBe("Check money");
    });
  });

  describe("humanizeResultCard", () => {
    it("humanizes a success result card", () => {
      const h = new ResponseHumanizer({ campaign: "treatment plan" });
      const card = h.humanizeResultCard({
        summary: "Campaign 'Summer Sale' paused",
        success: true,
        auditId: "env_abc123",
        riskCategory: "low",
        undoAvailable: true,
        undoExpiresAt: null,
      });
      expect(card.summary).toBe("All set! treatment plan 'Summer Sale' paused");
      expect(card.success).toBe(true);
      expect(card.auditId).toBe("env_abc123");
    });

    it("humanizes a failure result card", () => {
      const h = new ResponseHumanizer({});
      const card = h.humanizeResultCard({
        summary: "Campaign could not be paused",
        success: false,
        auditId: "env_xyz",
        riskCategory: "medium",
        undoAvailable: false,
        undoExpiresAt: null,
      });
      expect(card.summary).toBe("Something went wrong: campaign could not be paused.");
    });

    it("does not mutate the original card", () => {
      const h = new ResponseHumanizer({});
      const original = {
        summary: "Paused",
        success: true,
        auditId: "a",
        riskCategory: "low",
        undoAvailable: false,
        undoExpiresAt: null,
      };
      const humanized = h.humanizeResultCard(original);
      expect(original.summary).toBe("Paused");
      expect(humanized.summary).toBe("All set! Paused");
    });
  });

  describe("humanizeApprovalCard", () => {
    it("strips old prefix and sets new explanation", () => {
      const h = new ResponseHumanizer({});
      const card = h.humanizeApprovalCard({
        summary: "This action needs your approval:\n\nSet budget to $800",
        riskCategory: "high",
        explanation: "Risk: HIGH\nReason: Budget increase exceeds 50%",
        buttons: [],
      });
      expect(card.summary).toBe("Set budget to $800");
      expect(card.explanation).toBe("I need your OK before proceeding.");
    });

    it("applies terminology to the summary", () => {
      const h = new ResponseHumanizer({ budget: "spending limit" });
      const card = h.humanizeApprovalCard({
        summary: "This action needs your approval:\n\nSet budget to $800",
        riskCategory: "high",
        explanation: "Risk: HIGH",
        buttons: [{ label: "Approve", callbackData: "{}" }],
      });
      expect(card.summary).toBe("Set spending limit to $800");
      expect(card.buttons).toHaveLength(1);
    });

    it("handles summary without old prefix", () => {
      const h = new ResponseHumanizer({});
      const card = h.humanizeApprovalCard({
        summary: "Pause campaign X",
        riskCategory: "medium",
        explanation: "Risk: MEDIUM",
        buttons: [],
      });
      expect(card.summary).toBe("Pause campaign X");
    });
  });

  describe("humanizeDenial", () => {
    it("produces conversational denial with humanDetail", () => {
      const h = new ResponseHumanizer({});
      const result = h.humanizeDenial(
        "Action denied due to spend limit",
        "Budget exceeds daily spend limit of $500",
      );
      expect(result).toBe("I can't do that \u2014 budget exceeds daily spend limit of $500.");
    });

    it("falls back to explanation when no humanDetail", () => {
      const h = new ResponseHumanizer({});
      const result = h.humanizeDenial("Action denied due to spend limit");
      expect(result).toBe("I can't do that \u2014 action denied due to spend limit.");
    });

    it("applies terminology to denial text", () => {
      const h = new ResponseHumanizer({ campaign: "treatment plan" });
      const result = h.humanizeDenial("Denied", "Campaign is in learning phase");
      expect(result).toBe("I can't do that \u2014 treatment plan is in learning phase.");
    });
  });

  describe("no-skin fallback", () => {
    it("passes through text unchanged when no terminology is provided", () => {
      const h = new ResponseHumanizer();
      expect(h.applyTerminology("Campaign paused")).toBe("Campaign paused");

      const resultCard = h.humanizeResultCard({
        summary: "Campaign paused",
        success: true,
        auditId: "a",
        riskCategory: "low",
        undoAvailable: false,
        undoExpiresAt: null,
      });
      expect(resultCard.summary).toBe("All set! Campaign paused");
    });
  });
});
