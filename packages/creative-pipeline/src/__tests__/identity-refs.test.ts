// Provider-prefixed identity refs (slice-3 spec 3.5): `heygen:<avatar_id>`
// entries on CreatorIdentity.identityRefIds; no migration, bounded parsing.
import { describe, it, expect } from "vitest";
import { getProviderRef } from "../ugc/identity-refs.js";

describe("getProviderRef", () => {
  it("parses a provider-prefixed ref", () => {
    expect(getProviderRef({ identityRefIds: ["heygen:avatar_42", "other:x"] }, "heygen")).toBe(
      "avatar_42",
    );
  });

  it("returns undefined when no ref for the provider exists", () => {
    expect(getProviderRef({ identityRefIds: ["other:x"] }, "heygen")).toBeUndefined();
    expect(getProviderRef({ identityRefIds: [] }, "heygen")).toBeUndefined();
    expect(getProviderRef({}, "heygen")).toBeUndefined();
  });

  it("ignores malformed entries (empty id, bare provider)", () => {
    expect(getProviderRef({ identityRefIds: ["heygen:"] }, "heygen")).toBeUndefined();
    expect(getProviderRef({ identityRefIds: ["heygen"] }, "heygen")).toBeUndefined();
  });

  it("takes the first matching ref when several exist", () => {
    expect(getProviderRef({ identityRefIds: ["heygen:a1", "heygen:a2"] }, "heygen")).toBe("a1");
  });
});
