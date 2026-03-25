import { describe, it, expect } from "vitest";
import { validateTransition } from "../transition-validator.js";

describe("validateTransition", () => {
  describe("valid forward transitions", () => {
    it.each([
      ["interested", "qualified"],
      ["interested", "quoted"],
      ["interested", "booked"],
      ["interested", "lost"],
      ["interested", "nurturing"],
      ["qualified", "quoted"],
      ["qualified", "booked"],
      ["qualified", "lost"],
      ["qualified", "nurturing"],
      ["quoted", "booked"],
      ["quoted", "lost"],
      ["quoted", "nurturing"],
      ["booked", "showed"],
      ["booked", "lost"],
      ["booked", "nurturing"],
      ["showed", "won"],
      ["showed", "lost"],
      ["showed", "nurturing"],
    ] as const)("%s → %s is valid", (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(true);
    });
  });

  describe("re-engagement paths", () => {
    it.each([
      ["nurturing", "interested"],
      ["nurturing", "qualified"],
      ["nurturing", "lost"],
      ["lost", "nurturing"],
      ["lost", "interested"],
    ] as const)("%s → %s is valid", (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it.each([
      ["interested", "showed"],
      ["interested", "won"],
      ["qualified", "won"],
      ["qualified", "showed"],
      ["won", "interested"],
      ["won", "lost"],
      ["won", "nurturing"],
      ["booked", "interested"],
      ["booked", "qualified"],
      ["showed", "booked"],
      ["showed", "interested"],
    ] as const)("%s → %s is invalid", (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe("same-stage transition", () => {
    it("rejects same-stage", () => {
      const result = validateTransition("interested", "interested");
      expect(result.valid).toBe(false);
    });
  });
});
