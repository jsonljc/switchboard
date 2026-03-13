import { describe, it, expect, vi } from "vitest";
import {
  buildBookingUndoRecipe,
  buildCancelUndoRecipe,
  buildRescheduleUndoRecipe,
  buildCadenceStopUndoRecipe,
  buildJourneyStageUndoRecipe,
} from "../undo-recipes.js";
import { executeStartCadence } from "../start-cadence.js";
import { executeStopCadence } from "../stop-cadence.js";
import { executeLogTreatment } from "../log-treatment.js";
import { executeHandleObjection } from "../handle-objection.js";
import { executeSendReminder } from "../send-reminder.js";
import { executeRequestReview } from "../request-review.js";
import { executeRespondReview } from "../respond-review.js";

describe("undo recipes", () => {
  it("buildBookingUndoRecipe should create cancel recipe", () => {
    const recipe = buildBookingUndoRecipe("apt-1");
    expect(recipe.reverseActionType).toBe("customer-engagement.appointment.cancel");
    expect(recipe.reverseParameters).toEqual({ appointmentId: "apt-1", reason: "undo" });
    expect(recipe.undoRiskCategory).toBe("medium");
    expect(recipe.undoApprovalRequired).toBe("none");
  });

  it("buildCancelUndoRecipe should create re-book recipe", () => {
    const recipe = buildCancelUndoRecipe("apt-1", "2025-06-01T10:00:00Z");
    expect(recipe.reverseActionType).toBe("customer-engagement.appointment.book");
    expect(recipe.reverseParameters).toEqual({
      appointmentId: "apt-1",
      startTime: "2025-06-01T10:00:00Z",
    });
    expect(recipe.undoApprovalRequired).toBe("standard");
  });

  it("buildRescheduleUndoRecipe should create reschedule-back recipe", () => {
    const recipe = buildRescheduleUndoRecipe("apt-1", "2025-06-01T10:00:00Z");
    expect(recipe.reverseActionType).toBe("customer-engagement.appointment.reschedule");
    expect(recipe.reverseParameters).toEqual({
      appointmentId: "apt-1",
      newStartTime: "2025-06-01T10:00:00Z",
    });
  });

  it("buildCadenceStopUndoRecipe should create stop recipe", () => {
    const recipe = buildCadenceStopUndoRecipe("cad-1");
    expect(recipe.reverseActionType).toBe("customer-engagement.cadence.stop");
    expect(recipe.reverseParameters).toEqual({ cadenceInstanceId: "cad-1", reason: "undo" });
    expect(recipe.undoRiskCategory).toBe("low");
  });

  it("buildJourneyStageUndoRecipe should revert stage", () => {
    const recipe = buildJourneyStageUndoRecipe("contact-1", "awareness");
    expect(recipe.reverseActionType).toBe("customer-engagement.journey.update_stage");
    expect(recipe.reverseParameters).toEqual({
      contactId: "contact-1",
      newStage: "awareness",
      reason: "undo",
    });
  });
});

describe("action handlers", () => {
  describe("executeStartCadence", () => {
    it("should return success with cadence instance", async () => {
      const result = await executeStartCadence({
        contactId: "c-1",
        cadenceTemplateId: "reactivation-30",
      });
      expect(result.success).toBe(true);
      expect(result.summary).toContain("reactivation-30");
      expect(result.summary).toContain("c-1");
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe).not.toBeNull();
    });
  });

  describe("executeStopCadence", () => {
    it("should return success with reason", async () => {
      const result = await executeStopCadence({
        cadenceInstanceId: "cad-1",
        reason: "patient requested",
      });
      expect(result.success).toBe(true);
      expect(result.summary).toContain("cad-1");
      expect(result.summary).toContain("patient requested");
      expect(result.rollbackAvailable).toBe(false);
    });

    it("should default reason to manual", async () => {
      const result = await executeStopCadence({ cadenceInstanceId: "cad-2" });
      expect(result.summary).toContain("manual");
    });
  });

  describe("executeLogTreatment", () => {
    it("should log treatment with value", async () => {
      const result = await executeLogTreatment({
        contactId: "c-1",
        serviceType: "cleaning",
        value: 150,
        providerId: "dr-smith",
      });
      expect(result.success).toBe(true);
      expect(result.summary).toContain("cleaning");
      expect(result.summary).toContain("$150.00");
      expect(result.externalRefs["providerId"]).toBe("dr-smith");
    });
  });

  describe("executeHandleObjection", () => {
    it("should match a known objection", async () => {
      const result = await executeHandleObjection({
        contactId: "c-1",
        objectionText: "It costs too much money",
      });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should handle unrecognized objection", async () => {
      const result = await executeHandleObjection({
        contactId: "c-1",
        objectionText: "xyzzy random gibberish qwerty",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("executeSendReminder", () => {
    it("should send via SMS provider on success", async () => {
      const sms = {
        sendMessage: vi.fn().mockResolvedValue({ messageId: "msg-1", status: "sent" }),
        healthCheck: vi.fn(),
      };
      const result = await executeSendReminder(
        { contactId: "c-1", phoneNumber: "+15551234567", message: "Your appointment is tomorrow." },
        sms,
        "+15559999999",
      );
      expect(result.success).toBe(true);
      expect(result.externalRefs["messageId"]).toBe("msg-1");
      expect(sms.sendMessage).toHaveBeenCalledWith(
        "+15551234567",
        "+15559999999",
        "Your appointment is tomorrow.",
      );
    });

    it("should handle SMS failure", async () => {
      const sms = {
        sendMessage: vi.fn().mockRejectedValue(new Error("Network error")),
        healthCheck: vi.fn(),
      };
      const result = await executeSendReminder(
        { contactId: "c-1", phoneNumber: "+15551234567", message: "Reminder" },
        sms,
        "+15559999999",
      );
      expect(result.success).toBe(false);
      expect(result.partialFailures[0]?.error).toBe("Network error");
    });
  });

  describe("executeRequestReview", () => {
    it("should send review request", async () => {
      const review = {
        sendReviewRequest: vi.fn().mockResolvedValue({ requestId: "req-1", sent: true }),
        respondToReview: vi.fn(),
        getReviews: vi.fn(),
        healthCheck: vi.fn(),
      };
      const result = await executeRequestReview({ contactId: "c-1" }, review, "loc-1");
      expect(result.success).toBe(true);
      expect(result.externalRefs["requestId"]).toBe("req-1");
    });

    it("should handle review platform failure", async () => {
      const review = {
        sendReviewRequest: vi.fn().mockRejectedValue(new Error("API down")),
        respondToReview: vi.fn(),
        getReviews: vi.fn(),
        healthCheck: vi.fn(),
      };
      const result = await executeRequestReview({ contactId: "c-1" }, review, "loc-1");
      expect(result.success).toBe(false);
      expect(result.partialFailures[0]?.error).toBe("API down");
    });
  });

  describe("executeRespondReview", () => {
    it("should respond to a review", async () => {
      const review = {
        sendReviewRequest: vi.fn(),
        respondToReview: vi.fn().mockResolvedValue({ success: true }),
        getReviews: vi.fn(),
        healthCheck: vi.fn(),
      };
      const result = await executeRespondReview(
        { reviewId: "rev-1", responseText: "Thank you for your feedback!" },
        review,
        "loc-1",
      );
      expect(result.success).toBe(true);
      expect(result.externalRefs["reviewId"]).toBe("rev-1");
    });

    it("should handle respond failure", async () => {
      const review = {
        sendReviewRequest: vi.fn(),
        respondToReview: vi.fn().mockRejectedValue(new Error("Forbidden")),
        getReviews: vi.fn(),
        healthCheck: vi.fn(),
      };
      const result = await executeRespondReview(
        { reviewId: "rev-1", responseText: "Thanks" },
        review,
        "loc-1",
      );
      expect(result.success).toBe(false);
    });
  });
});
