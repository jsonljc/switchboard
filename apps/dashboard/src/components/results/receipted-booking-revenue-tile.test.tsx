import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { ReceiptedBookingRevenueTile } from "./receipted-booking-revenue-tile";

describe("ReceiptedBookingRevenueTile", () => {
  it("shows the summed receipted revenue in major units with cohort coverage", () => {
    // goodFixture revenue: 6_150_000 cents = 61,500 major; 38 of 41 bookings carried a value.
    const model = buildResultsModel(goodFixture);
    const { container } = render(<ReceiptedBookingRevenueTile model={model} />);
    const text = container.textContent ?? "";

    expect(text).toContain("61,500");
    expect(text).toContain("38 of 41 bookings valued");
  });

  it("shows a quiet empty state when the cohort is empty", () => {
    const model = buildResultsModel(quietFixture); // cohortSize 0
    const { container } = render(<ReceiptedBookingRevenueTile model={model} />);
    const text = container.textContent ?? "";

    expect(text).toContain("No receipted bookings this period.");
    expect(text).not.toContain("valued");
  });
});
