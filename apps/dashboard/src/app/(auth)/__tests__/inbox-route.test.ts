import { describe, it, expect } from "vitest";
import InboxPage from "../inbox/page";
import ResultsPage from "../results/page";
describe("new primary routes", () => {
  it("inbox + results pages export components", () => {
    expect(typeof InboxPage).toBe("function");
    expect(typeof ResultsPage).toBe("function");
  });
});
