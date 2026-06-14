import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { ReceiptedBookingsTile } from "./receipted-bookings-tile";

describe("ReceiptedBookingsTile", () => {
  it("renders the receipted-bookings count for a populated period", () => {
    const model = buildResultsModel(goodFixture); // { count: 41 }
    const { container } = render(<ReceiptedBookingsTile model={model} />);
    expect(container.textContent).toContain("41");
  });

  it("renders an em-dash placeholder when there are no receipted bookings (count 0)", () => {
    const model = buildResultsModel(quietFixture); // { count: 0 }
    const { container } = render(<ReceiptedBookingsTile model={model} />);
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("NaN");
  });

  it("labels the metric as receipted bookings", () => {
    const model = buildResultsModel(goodFixture);
    const { container } = render(<ReceiptedBookingsTile model={model} />);
    expect(container.textContent?.toLowerCase()).toContain("receipted bookings");
  });
});
