import { describe, it, expect } from "vitest";
import { extractPriceClaims, findUnsubstantiatedPriceClaims } from "../price-claim-scanner.js";

describe("extractPriceClaims", () => {
  it("detects a leading currency-symbol amount", () => {
    expect(extractPriceClaims("It's $50 for a session.")).toEqual([{ raw: "$50", amount: 50 }]);
  });

  it("detects a leading ISO-code amount with a thousands separator", () => {
    expect(extractPriceClaims("Botox is SGD 1,200 total.")).toEqual([
      { raw: "SGD 1,200", amount: 1200 },
    ]);
  });

  it("detects a trailing currency-word amount", () => {
    expect(extractPriceClaims("We charge 80 dollars.")).toEqual([
      { raw: "80 dollars", amount: 80 },
    ]);
  });

  it("detects the Malaysian ringgit symbol", () => {
    expect(extractPriceClaims("That's RM150 in KL.")).toEqual([{ raw: "RM150", amount: 150 }]);
  });

  it("detects a decimal amount", () => {
    expect(extractPriceClaims("Deposit is $50.00.")).toEqual([{ raw: "$50.00", amount: 50 }]);
  });

  it("detects multiple amounts in one reply", () => {
    expect(extractPriceClaims("A $50 deposit, then $1,200 total.")).toEqual([
      { raw: "$50", amount: 50 },
      { raw: "$1,200", amount: 1200 },
    ]);
  });

  it("does NOT flag bare numbers without a currency marker (times, counts, durations)", () => {
    expect(extractPriceClaims("Open at 9am for 30 minutes across 3 locations.")).toEqual([]);
  });

  it("returns [] for an empty / price-less reply", () => {
    expect(extractPriceClaims("Happy to help you book a consultation!")).toEqual([]);
  });

  // Boundary cases — pin the intended behaviour so the edges read as decisions.

  it("detects a TRAILING ringgit amount (the MY '150 RM' price form)", () => {
    // A trailing RM is a real MY price form; missing it would be a false NEGATIVE
    // (a leaked fabricated price — the dangerous direction for this gate).
    expect(extractPriceClaims("That's 150 RM all in.")).toEqual([{ raw: "150 RM", amount: 150 }]);
  });

  it("treats a k-suffix literally ($1.2k -> 1.2): an intentional, SAFE over-block", () => {
    // k/m suffixes are not expanded. "$1.2k" parses as 1.2, which won't match an
    // approved 1200 and therefore over-blocks in enforce (recoverable), never leaks.
    expect(extractPriceClaims("Around $1.2k.")).toEqual([{ raw: "$1.2", amount: 1.2 }]);
  });

  it("ignores spelled-out amounts (digits are required, by design)", () => {
    expect(extractPriceClaims("It's fifty dollars.")).toEqual([]);
  });
});

describe("findUnsubstantiatedPriceClaims", () => {
  it("allows a price that matches an operator-approved service price", () => {
    expect(findUnsubstantiatedPriceClaims("It's $50.", [50])).toEqual([]);
  });

  it("flags a price that is NOT in the approved set", () => {
    expect(findUnsubstantiatedPriceClaims("It's $60.", [50])).toEqual([{ raw: "$60", amount: 60 }]);
  });

  it("flags only the unsubstantiated amount when some match", () => {
    expect(findUnsubstantiatedPriceClaims("A $50 deposit, $80 total.", [50])).toEqual([
      { raw: "$80", amount: 80 },
    ]);
  });

  it("matches across formatting differences (commas / ISO code)", () => {
    expect(findUnsubstantiatedPriceClaims("Total SGD 1,200.", [1200])).toEqual([]);
  });

  it("fails closed: ANY price claim is unsubstantiated when no approved prices exist", () => {
    expect(findUnsubstantiatedPriceClaims("It's $50.", [])).toEqual([{ raw: "$50", amount: 50 }]);
  });

  it("is a no-op when the reply mentions no prices, even with no approved prices", () => {
    expect(findUnsubstantiatedPriceClaims("Let's get you booked!", [])).toEqual([]);
  });
});
