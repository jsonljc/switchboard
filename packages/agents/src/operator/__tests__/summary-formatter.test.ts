import { describe, it, expect } from "vitest";
import { SummaryFormatter } from "../summary-formatter.js";

describe("SummaryFormatter", () => {
  const formatter = new SummaryFormatter();

  describe("formatSuccess", () => {
    it("formats compact for telegram", () => {
      const result = formatter.formatSuccess("follow_up_leads", { leadsContacted: 5 }, "telegram");
      expect(result).toContain("5");
      expect(result.length).toBeLessThan(500);
    });

    it("formats compact for whatsapp", () => {
      const result = formatter.formatSuccess("pause_campaigns", { campaignsPaused: 3 }, "whatsapp");
      expect(result).toContain("3");
    });

    it("formats rich for dashboard", () => {
      const result = formatter.formatSuccess(
        "show_pipeline",
        { totalDeals: 12, totalValue: 45000 },
        "dashboard",
      );
      expect(result).toContain("12");
      expect(result).toContain("45000");
    });
  });

  describe("formatError", () => {
    it("formats error message for any channel", () => {
      const result = formatter.formatError("Command failed: timeout", "telegram");
      expect(result).toContain("failed");
    });
  });

  describe("formatConfirmationPrompt", () => {
    it("asks for confirmation with command summary", () => {
      const result = formatter.formatConfirmationPrompt(
        "pause_campaigns",
        [{ type: "campaign", id: "camp-1" }],
        "telegram",
      );
      expect(result).toContain("pause");
      expect(result).toContain("confirm");
    });
  });

  describe("formatClarificationPrompt", () => {
    it("asks for clarification with missing entity hints", () => {
      const result = formatter.formatClarificationPrompt(["campaign"], "telegram");
      expect(result).toContain("campaign");
    });
  });
});
