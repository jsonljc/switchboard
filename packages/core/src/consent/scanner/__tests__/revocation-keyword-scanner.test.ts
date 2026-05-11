import { describe, it, expect } from "vitest";
import { scanForRevocationKeywords } from "../revocation-keyword-scanner.js";
import { loadRevocationKeywords } from "../../revocation-keywords/loader.js";

describe("scanForRevocationKeywords", () => {
  const sg = loadRevocationKeywords("SG");
  const my = loadRevocationKeywords("MY");

  it("matches STOP case-insensitively", () => {
    const matches = scanForRevocationKeywords("stop messaging me", sg);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.entry.id).toBe("stop_baseline");
  });

  it("matches MY-specific berhenti+messaging context", () => {
    const matches = scanForRevocationKeywords("berhenti hantar pesanan", my);
    expect(matches.some((m) => m.entry.id === "my_berhenti_messaging")).toBe(true);
  });

  it("returns multiple matches in order when both fire", () => {
    const matches = scanForRevocationKeywords("STOP and please unsubscribe me", sg);
    const ids = matches.map((m) => m.entry.id);
    expect(ids).toContain("stop_baseline");
    expect(ids).toContain("unsubscribe");
  });

  it.each([
    "I'll come by tomorrow",
    "Could you remove the extra topping from my order?",
    "berhenti makan ubat",
    "Can we pause for two weeks?",
    "Please cancel the appointment",
  ])("does not match benign sentence: %s", (text) => {
    const matches = scanForRevocationKeywords(text, my);
    expect(matches.length).toBe(0);
  });

  it("returns empty array on no match", () => {
    expect(scanForRevocationKeywords("hi looking to book a facial", sg)).toEqual([]);
  });
});
