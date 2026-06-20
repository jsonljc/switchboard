import { describe, expect, it } from "vitest";
import { buildHomeSummary, type HomeSummarySignals } from "../home-summary.js";

function signals(
  over: Partial<Record<"valueThis" | "valuePrev" | "countThis" | "countPrev", number>>,
): HomeSummarySignals {
  const v = { valueThis: 480000, valuePrev: 300000, countThis: 5, countPrev: 3, ...over };
  return {
    sumAttributedBookedValueCentsForWindow: ({ from }) =>
      Promise.resolve(
        from.getTime() >= new Date("2026-06-14T16:00:00.000Z").getTime()
          ? v.valueThis
          : v.valuePrev,
      ),
    countBookedConversionsForWindow: ({ from }) =>
      Promise.resolve(
        from.getTime() >= new Date("2026-06-14T16:00:00.000Z").getTime()
          ? v.countThis
          : v.countPrev,
      ),
  };
}

const NOW = new Date("2026-06-18T08:00:00.000Z"); // a Thursday
const TZ = "Asia/Singapore";

describe("buildHomeSummary", () => {
  it("returns ready cents value + count with prior-week comparators", async () => {
    const s = await buildHomeSummary({
      orgId: "org_1",
      now: NOW,
      timezone: TZ,
      signals: signals({}),
    });
    expect(s.currency).toBe("SGD");
    expect(s.attributedValueCents.state).toBe("ready");
    if (s.attributedValueCents.state === "ready") {
      expect(s.attributedValueCents.value).toBe(480000);
      expect(s.attributedValueCents.comparator?.value).toBe(300000);
    }
    expect(s.bookings.state).toBe("ready");
    if (s.bookings.state === "ready") expect(s.bookings.value).toBe(5);
  });

  it("reports empty (no_current_week_bookings) when this week is zero", async () => {
    const s = await buildHomeSummary({
      orgId: "org_1",
      now: NOW,
      timezone: TZ,
      signals: signals({ valueThis: 0, countThis: 0 }),
    });
    expect(s.attributedValueCents.state).toBe("empty");
    expect(s.bookings.state).toBe("empty");
    if (s.bookings.state === "empty") expect(s.bookings.reason).toBe("no_current_week_bookings");
  });

  it("omits the comparator (no +inf) when there is no prior-week baseline", async () => {
    const s = await buildHomeSummary({
      orgId: "org_1",
      now: NOW,
      timezone: TZ,
      signals: signals({ valuePrev: 0, countPrev: 0 }),
    });
    if (s.attributedValueCents.state === "ready")
      expect(s.attributedValueCents.comparator).toBeUndefined();
  });
});
