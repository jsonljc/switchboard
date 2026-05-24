import { describe, it, expect } from "vitest";
import HomePage from "../page";
describe("authed home route", () => {
  it("exports a Home page component", () => {
    expect(typeof HomePage).toBe("function");
  });
});
