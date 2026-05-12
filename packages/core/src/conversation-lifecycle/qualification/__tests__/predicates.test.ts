import { describe, expect, it } from "vitest";
import type { ConversationLifecycleSnapshot } from "@switchboard/schemas";
import { isPendingDisqualification } from "../predicates.js";

const base: ConversationLifecycleSnapshot = {
  conversationThreadId: "t",
  organizationId: "o",
  contactId: "c",
  currentState: "active",
  qualificationStatus: "unknown",
  bookingStatus: "not_booked",
  dropoffReason: null,
  lastTransitionAt: new Date(),
  lastEvaluatedAt: new Date(),
  updatedAt: new Date(),
};

describe("isPendingDisqualification", () => {
  it("true when qualificationStatus=proposed_disqualified AND currentState!=disqualified", () => {
    expect(
      isPendingDisqualification({ ...base, qualificationStatus: "proposed_disqualified" }),
    ).toBe(true);
  });

  it("false when operator already confirmed (currentState=disqualified)", () => {
    expect(
      isPendingDisqualification({
        ...base,
        qualificationStatus: "proposed_disqualified",
        currentState: "disqualified",
      }),
    ).toBe(false);
  });

  it("false when qualificationStatus is anything other than proposed_disqualified", () => {
    expect(isPendingDisqualification({ ...base, qualificationStatus: "qualified" })).toBe(false);
    expect(isPendingDisqualification({ ...base, qualificationStatus: "unqualified" })).toBe(false);
    expect(isPendingDisqualification({ ...base, qualificationStatus: "unknown" })).toBe(false);
  });
});
