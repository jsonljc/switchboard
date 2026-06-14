import { describe, it, expect } from "vitest";
import { RecordAttendanceParametersSchema } from "../operator-intents-schemas.js";

describe("RecordAttendanceParametersSchema", () => {
  it("accepts attended/no_show and defaults recordedBy to owner", () => {
    expect(
      RecordAttendanceParametersSchema.parse({ bookingId: "b1", outcome: "attended" }),
    ).toEqual({
      bookingId: "b1",
      outcome: "attended",
      recordedBy: "owner",
    });
  });
  it("rejects an unknown outcome", () => {
    expect(
      RecordAttendanceParametersSchema.safeParse({ bookingId: "b1", outcome: "maybe" }).success,
    ).toBe(false);
  });
});
