import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { ReceiptedBookingQualityTile } from "./receipted-booking-quality-tile";

// ReconcileRowAction uses useQueryClient and useScopedQueryKeys; stub them so this
// tile test does not require a QueryClientProvider wrapper.
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn<(args: { queryKey: unknown }) => Promise<void>>(() =>
      Promise.resolve(),
    ),
  }),
}));
vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({ reports: { all: () => ["__test__", "reports"] } }),
}));

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

    // The per-booking drill-down: the actual bookings behind the count, by service + appointment.
    expect(text).toContain("Lip filler");
    expect(text).toContain("Botox consult");
    expect(text).toContain("16 Jun"); // bk-good-1 startsAt 02:30Z => 10:30 SGT, 16 Jun
    // Nothing is truncated when the worklist holds every needing-attention booking (4 of 4).
    expect(text).not.toContain("showing first");
  });

  it("surfaces an honest truncation indicator when the worklist is capped below the total", () => {
    const truncated = buildResultsModel({
      ...goodFixture,
      receiptedBookingQuality: {
        ...goodFixture.receiptedBookingQuality,
        bookingsNeedingAttention: 5,
        worklist: goodFixture.receiptedBookingQuality.worklist.slice(0, 2),
      },
    });
    const { container } = render(<ReceiptedBookingQualityTile model={truncated} />);
    const text = container.textContent ?? "";

    expect(text).toContain("showing first 2 of 5");
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
