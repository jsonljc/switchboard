import { describe, it, expect } from "vitest";
import {
  ConsentJurisdictionMismatch,
  ConsentNotesRequired,
  ConsentRevokedCannotRegrant,
  ConsentSystemActorRejected,
  ContactNotFound,
} from "../errors.js";

describe("ConsentJurisdictionMismatch", () => {
  it("carries stamped + provided properties", () => {
    const err = new ConsentJurisdictionMismatch({
      contactId: "c1",
      stamped: "SG",
      provided: "MY",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConsentJurisdictionMismatch");
    expect(err.contactId).toBe("c1");
    expect(err.stamped).toBe("SG");
    expect(err.provided).toBe("MY");
  });
});

describe("ConsentRevokedCannotRegrant", () => {
  it("carries contactId and revokedAt", () => {
    const at = new Date("2026-05-10");
    const err = new ConsentRevokedCannotRegrant({ contactId: "c1", revokedAt: at });
    expect(err.name).toBe("ConsentRevokedCannotRegrant");
    expect(err.contactId).toBe("c1");
    expect(err.revokedAt).toEqual(at);
  });
});

describe("ContactNotFound", () => {
  it("carries contactId", () => {
    const err = new ContactNotFound({ contactId: "c1" });
    expect(err.name).toBe("ContactNotFound");
    expect(err.contactId).toBe("c1");
  });
});

describe("ConsentNotesRequired", () => {
  it("is an Error subclass with stable name", () => {
    const err = new ConsentNotesRequired();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConsentNotesRequired");
    expect(err.message).toMatch(/notes/);
  });
});

describe("ConsentSystemActorRejected", () => {
  it("carries the rejected actor for audit trail", () => {
    const err = new ConsentSystemActorRejected({ actor: "system:bot" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConsentSystemActorRejected");
    expect(err.actor).toBe("system:bot");
    expect(err.message).toMatch(/system:/);
  });
});
