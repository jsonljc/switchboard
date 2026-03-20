import { describe, it, expect } from "vitest";
import { detectOptOut, detectOptIn, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS } from "../opt-out.js";

describe("Opt-out detection", () => {
  it("detects STOP keyword", () => {
    expect(detectOptOut("STOP")).toBe(true);
  });

  it("detects UNSUBSCRIBE keyword", () => {
    expect(detectOptOut("UNSUBSCRIBE")).toBe(true);
  });

  it("detects OPT OUT keyword", () => {
    expect(detectOptOut("OPT OUT")).toBe(true);
  });

  it("detects CANCEL keyword", () => {
    expect(detectOptOut("CANCEL")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(detectOptOut("stop")).toBe(true);
    expect(detectOptOut("Stop")).toBe(true);
    expect(detectOptOut("unsubscribe")).toBe(true);
  });

  it("is whitespace-tolerant", () => {
    expect(detectOptOut("  STOP  ")).toBe(true);
    expect(detectOptOut(" opt  out ")).toBe(true);
  });

  it("does not false-positive on regular messages", () => {
    expect(detectOptOut("I want to stop by for a consultation")).toBe(false);
    expect(detectOptOut("Can you cancel my Tuesday appointment?")).toBe(false);
    expect(detectOptOut("Please help me")).toBe(false);
  });

  it("detects exact opt-out as the full message content", () => {
    expect(detectOptOut("stop")).toBe(true);
    expect(detectOptOut("I want to stop")).toBe(false);
  });

  it("exports keyword lists for inspection", () => {
    expect(OPT_OUT_KEYWORDS.length).toBeGreaterThan(0);
    expect(OPT_IN_KEYWORDS.length).toBeGreaterThan(0);
  });
});

describe("Opt-in detection", () => {
  it("detects START keyword", () => {
    expect(detectOptIn("START")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(detectOptIn("start")).toBe(true);
  });

  it("does not false-positive on regular messages", () => {
    expect(detectOptIn("When do we start?")).toBe(false);
  });
});
