import { describe, it, expect } from "vitest";
import { normalizeGeneric } from "../normalizers/generic.js";
import { normalizeWebflow } from "../normalizers/webflow.js";
import { normalizeGoogleForms } from "../normalizers/google-forms.js";

describe("generic normalizer", () => {
  it("extracts canonical fields and stashes extras in metadata.extra", () => {
    const out = normalizeGeneric({
      name: "Sarah",
      phone: "+6591234567",
      email: "s@example.com",
      message: "interested",
      page: "https://b.com/x",
      utmSource: "google",
      fbclid: "abc",
      favorite: "blue",
    });
    expect(out.name).toBe("Sarah");
    expect(out.phone).toBe("+6591234567");
    expect(out.email).toBe("s@example.com");
    expect(out.message).toBe("interested");
    expect(out.metadata.page).toBe("https://b.com/x");
    expect(out.metadata.utmSource).toBe("google");
    expect(out.metadata.fbclid).toBe("abc");
    expect(out.metadata.extra).toEqual({ favorite: "blue" });
  });

  it("concatenates firstName + lastName into name when both present", () => {
    const out = normalizeGeneric({ firstName: "Sarah", lastName: "Tan", phone: "+6591234567" });
    expect(out.name).toBe("Sarah Tan");
  });

  it("matches snake_case aliases", () => {
    const out = normalizeGeneric({ phone_number: "+6591234567", email_address: "s@e.com" });
    expect(out.phone).toBe("+6591234567");
    expect(out.email).toBe("s@e.com");
  });

  it("captures dedupeKey when present", () => {
    const out = normalizeGeneric({ phone: "+6591234567", dedupeKey: "abc-123" });
    expect(out.dedupeKey).toBe("abc-123");
  });
});

describe("webflow normalizer", () => {
  it("unwraps `data` and applies generic logic", () => {
    const out = normalizeWebflow({
      data: { Name: "Sarah", Phone: "+6591234567", Email: "s@e.com" },
      siteId: "site_123",
      formId: "form_42",
    });
    expect(out.name).toBe("Sarah");
    expect(out.phone).toBe("+6591234567");
    expect(out.sourceDetail).toBe("webflow:form_42");
  });

  it("handles missing formId gracefully", () => {
    const out = normalizeWebflow({ data: { Phone: "+6591234567" } });
    expect(out.sourceDetail).toBe("webflow");
  });
});

describe("google-forms normalizer", () => {
  it("treats payload as already-normalized flat object", () => {
    const out = normalizeGoogleForms({
      name: "Sarah",
      phone: "+6591234567",
      message: "hi",
      page: "https://b.com",
    });
    expect(out.name).toBe("Sarah");
    expect(out.phone).toBe("+6591234567");
    expect(out.message).toBe("hi");
    expect(out.metadata.page).toBe("https://b.com");
    expect(out.sourceDetail).toBe("google-forms");
  });
});
