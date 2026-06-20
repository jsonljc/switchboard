import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { ReceiptedBookingRevenueTile } from "./receipted-booking-revenue-tile";

describe("ReceiptedBookingRevenueTile", () => {
  it("leads with proven-paid revenue and keeps expected as the secondary booked line", () => {
    // goodFixture: paid 2_870_000 cents = 28,700 major, 19 of 41 paid; expected 6_150_000 = 61,500,
    // 38 of 41 carried a value.
    const model = buildResultsModel(goodFixture);
    const { container } = render(<ReceiptedBookingRevenueTile model={model} />);
    const text = container.textContent ?? "";

    // Headline = proven paid (the north star's final link).
    expect(text).toContain("28,700");
    expect(text).toContain("19 of 41 bookings paid");
    // Secondary = the expected/booked dimension, retained as context.
    expect(text).toContain("61,500");
    expect(text).toContain("38 of 41 valued");
  });

  it("shows a quiet empty state when the cohort is empty", () => {
    const model = buildResultsModel(quietFixture); // cohortSize 0
    const { container } = render(<ReceiptedBookingRevenueTile model={model} />);
    const text = container.textContent ?? "";

    expect(text).toContain("No receipted bookings this period.");
    expect(text).not.toContain("valued");
  });
});
