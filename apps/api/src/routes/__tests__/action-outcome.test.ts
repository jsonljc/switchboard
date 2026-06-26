import { describe, it, expect } from "vitest";
import { classifySuccessOutcome } from "../action-outcome.js";

// Guards the success-by-elimination bug (2026-06-26 audit, dist-seam-parsing): the
// actions route used to label anything not "failed"/approvalRequired as "EXECUTED",
// so an async "queued" WorkOutcome (workflow-mode defers) read as a completed
// synchronous mutation. Only "completed" is EXECUTED.
describe("classifySuccessOutcome", () => {
  it("maps completed -> EXECUTED", () => {
    expect(classifySuccessOutcome("completed")).toBe("EXECUTED");
  });

  it("maps queued -> QUEUED (async-deferred, not a synchronous success)", () => {
    expect(classifySuccessOutcome("queued")).toBe("QUEUED");
  });

  it("maps any other non-completed outcome -> ERROR (never a false EXECUTED)", () => {
    expect(classifySuccessOutcome("running")).toBe("ERROR");
    expect(classifySuccessOutcome("pending_approval")).toBe("ERROR");
  });
});
