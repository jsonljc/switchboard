import { describe, expect, it } from "vitest";
import { extractContactRef } from "../contact-snapshot-extractors.js";

describe("extractContactRef", () => {
  it("reads contactId from booking.create snapshot", () => {
    expect(
      extractContactRef("booking.create", {
        booking: { contactId: "c-123", contactDisplayName: "Maya Lin" },
      }),
    ).toEqual({ contactId: "c-123", displayName: "Maya Lin" });
  });

  it("reads contactId from lifecycle.qualified snapshot", () => {
    expect(
      extractContactRef("lifecycle.qualified", {
        contactId: "c-456",
        contact: { displayName: "Jordan F." },
      }),
    ).toEqual({ contactId: "c-456", displayName: "Jordan F." });
  });

  it("reads contactId from message.sent snapshot", () => {
    expect(
      extractContactRef("message.sent", {
        message: { contactId: "c-789", contactDisplayName: "Sam R." },
      }),
    ).toEqual({ contactId: "c-789", displayName: "Sam R." });
  });

  it("reads contactId from approval.created snapshot", () => {
    expect(
      extractContactRef("approval.created", {
        approval: { contactId: "c-321", contactDisplayName: "Pat K." },
      }),
    ).toEqual({ contactId: "c-321", displayName: "Pat K." });
  });

  it("reads contactId from escalation.created snapshot", () => {
    expect(
      extractContactRef("escalation.created", {
        contactId: "c-654",
        contactDisplayName: "Robin L.",
      }),
    ).toEqual({ contactId: "c-654", displayName: "Robin L." });
  });

  it("returns null for unknown event type", () => {
    expect(extractContactRef("system.unknown.event", { foo: "bar" })).toBeNull();
  });

  it("returns null for malformed snapshot (no contactId anywhere)", () => {
    expect(extractContactRef("booking.create", {})).toBeNull();
  });

  it("returns null when contactId is not a string", () => {
    expect(
      extractContactRef("booking.create", {
        booking: { contactId: 123, contactDisplayName: "X" },
      }),
    ).toBeNull();
  });
});
