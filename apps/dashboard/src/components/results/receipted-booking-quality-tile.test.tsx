import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { ReceiptedBookingQualityTile } from "./receipted-booking-quality-tile";

describe("ReceiptedBookingQualityTile", () => {
  it("leads with strongly-attributed, breaks down the confidence rungs, and lists the worklist", () => {
    // goodFixture quality: deterministic 18 + high 12 = 30 strongly attributed of 41;
    // 4 need attention; missing_consent 2, missing_source 1, duplicate 1, manual_override 0.
    const model = buildResultsModel(goodFixture);
    const { container } = render(<ReceiptedBookingQualityTile model={model} />);
    const text = container.textContent ?? "";

    expect(text).toContain("30 of 41 strongly attributed");
    // Every confidence rung surfaces (Unattributed is meaningful even at 1).
    expect(text).toContain("Unattributed");
    // Worklist size + the active exception codes, by label.
    expect(text).toContain("4 need attention");
    expect(text).toContain("Missing consent");
    expect(text).toContain("Missing source");
    // A zero-count exception code is not shown in the worklist.
    expect(text).not.toContain("Manual override");
  });

  it("shows a quiet empty state (no rungs, no dash) when the cohort is empty", () => {
    const model = buildResultsModel(quietFixture); // cohortSize 0
    const { container } = render(<ReceiptedBookingQualityTile model={model} />);
    const text = container.textContent ?? "";

    expect(text).toContain("No receipted bookings to analyze this period.");
    expect(text).not.toContain("strongly attributed");
    expect(text).not.toContain("need attention");
  });
});
