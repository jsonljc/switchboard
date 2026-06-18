import { describe, it, expect } from "vitest";
import {
  selectRecoveryCandidates,
  type RecoveryCandidateInput,
} from "./select-recovery-candidates.js";

const c = (bookingId: string, contactId: string): RecoveryCandidateInput => ({
  bookingId,
  contactId,
  service: "svc",
  startsAt: new Date("2026-06-03T09:00:00Z"),
  attendeeName: null,
});

describe("selectRecoveryCandidates", () => {
  it("excludes contacts who already hold a future booking (already rebooked)", () => {
    const out = selectRecoveryCandidates([c("bk_1", "ct_1"), c("bk_2", "ct_2")], {
      existingFutureBookingContactIds: new Set(["ct_2"]),
    });
    expect(out.map((x) => x.contactId)).toEqual(["ct_1"]);
  });

  it("dedupes to one recovery attempt per contact (keeps the first by input order)", () => {
    const out = selectRecoveryCandidates([c("bk_1", "ct_1"), c("bk_2", "ct_1")], {
      existingFutureBookingContactIds: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.bookingId).toBe("bk_1");
  });

  it("returns empty for an empty cohort", () => {
    expect(selectRecoveryCandidates([], { existingFutureBookingContactIds: new Set() })).toEqual(
      [],
    );
  });
});
