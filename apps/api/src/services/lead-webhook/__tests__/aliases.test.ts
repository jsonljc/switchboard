import { describe, it, expect } from "vitest";
import { matchAlias } from "../aliases.js";

describe("matchAlias", () => {
  it("matches phone aliases case-insensitively", () => {
    expect(matchAlias("Phone")).toBe("phone");
    expect(matchAlias("phone_number")).toBe("phone");
    expect(matchAlias("Mobile Number")).toBe("phone");
    expect(matchAlias("WHATSAPP")).toBe("phone");
  });

  it("matches email aliases", () => {
    expect(matchAlias("E-Mail")).toBe("email");
    expect(matchAlias("emailAddress")).toBe("email");
  });

  it("matches name aliases", () => {
    expect(matchAlias("Full Name")).toBe("name");
    expect(matchAlias("fullName")).toBe("name");
    expect(matchAlias("firstName")).toBe("firstName");
    expect(matchAlias("lastName")).toBe("lastName");
  });

  it("matches message aliases", () => {
    expect(matchAlias("Notes")).toBe("message");
    expect(matchAlias("enquiry")).toBe("message");
  });

  it("returns null for unknown labels", () => {
    expect(matchAlias("favourite_color")).toBeNull();
  });
});
