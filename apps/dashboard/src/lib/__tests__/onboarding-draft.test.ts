import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
} from "../onboarding-draft";

describe("onboarding draft storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns null when no draft exists", () => {
    expect(loadOnboardingDraft("org-1")).toBeNull();
  });

  it("saves and loads a draft for an organization", () => {
    saveOnboardingDraft("org-1", {
      scanUrl: "https://example.com",
      category: "Dental Clinic",
    });

    expect(loadOnboardingDraft("org-1")).toEqual({
      scanUrl: "https://example.com",
      category: "Dental Clinic",
    });
  });

  it("keeps drafts isolated per organization", () => {
    saveOnboardingDraft("org-1", {
      scanUrl: "https://one.example.com",
      category: null,
    });
    saveOnboardingDraft("org-2", {
      scanUrl: null,
      category: "Salon",
    });

    expect(loadOnboardingDraft("org-1")).toEqual({
      scanUrl: "https://one.example.com",
      category: null,
    });
    expect(loadOnboardingDraft("org-2")).toEqual({
      scanUrl: null,
      category: "Salon",
    });
  });

  it("returns null for malformed stored data", () => {
    sessionStorage.setItem("sw-onboarding-draft:org-1", "{not-json");

    expect(loadOnboardingDraft("org-1")).toBeNull();
  });

  it("clears a saved draft", () => {
    saveOnboardingDraft("org-1", {
      scanUrl: "https://example.com",
      category: null,
    });

    clearOnboardingDraft("org-1");

    expect(loadOnboardingDraft("org-1")).toBeNull();
  });
});
