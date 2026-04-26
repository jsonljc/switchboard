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

import tallyFixture from "./fixtures/tally.json" with { type: "json" };
import typeformFixture from "./fixtures/typeform.json" with { type: "json" };
import { normalizeTally } from "../normalizers/tally.js";
import { normalizeTypeform } from "../normalizers/typeform.js";

describe("tally normalizer", () => {
  it("walks data.fields and matches by label", () => {
    const out = normalizeTally(tallyFixture);
    expect(out.name).toBe("Sarah Tan");
    expect(out.phone).toBe("+6591234567");
    expect(out.email).toBe("sarah@example.com");
    expect(out.message).toBe("lash lift this week?");
    expect(out.sourceDetail).toBe("tally:form_xyz");
    expect(out.metadata.extra).toMatchObject({ "Favourite colour": "blue" });
  });

  it("derives dedupeKey from submissionId", () => {
    const out = normalizeTally(tallyFixture);
    expect(out.dedupeKey).toBe("tally:s_def");
  });
});

describe("typeform normalizer", () => {
  it("walks form_response.answers and matches by ref then title", () => {
    const out = normalizeTypeform(typeformFixture);
    expect(out.name).toBe("Sarah Tan");
    expect(out.phone).toBe("+6591234567");
    expect(out.email).toBe("sarah@example.com");
    expect(out.message).toBe("lash lift this week?");
    expect(out.sourceDetail).toBe("typeform:FORMID");
    expect(out.metadata.page).toBe("https://brand.com/contact");
    expect(out.metadata.utmSource).toBe("google");
  });

  it("derives dedupeKey from form_response.token", () => {
    const out = normalizeTypeform(typeformFixture);
    expect(out.dedupeKey).toBe("typeform:tok_abc");
  });
});
