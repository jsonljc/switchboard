import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProfileLoader } from "../loader.js";
import { ProfileResolver } from "../resolver.js";
import type { BusinessProfile } from "@switchboard/schemas";

// ── Mock fs/promises globally for ProfileLoader tests ──
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
const mockedReadFile = vi.mocked(readFile);

// ── Test Data ──

function makeValidProfile(overrides?: Partial<BusinessProfile>): BusinessProfile {
  return {
    id: "test-profile",
    name: "Test Business",
    version: "1.0.0",
    business: {
      name: "Test Business",
      type: "general",
    },
    services: {
      catalog: [{ id: "svc1", name: "Service One", category: "general" }],
    },
    journey: {
      stages: [
        { id: "new_lead", name: "New Lead", metric: "new_leads", terminal: false },
        { id: "qualified", name: "Qualified", metric: "qualified_leads", terminal: false },
        { id: "lost", name: "Lost", metric: "lost", terminal: true },
      ],
      primaryKPI: "qualified_leads",
    },
    ...overrides,
  };
}

// ── ProfileLoader Tests ──

describe("ProfileLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when profile file does not exist", async () => {
    const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockedReadFile.mockRejectedValueOnce(err);

    const loader = new ProfileLoader("/tmp/profiles");
    await expect(loader.load("missing")).rejects.toThrow("Business profile not found");
  });

  it("throws on non-ENOENT file errors", async () => {
    const err = new Error("Permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    mockedReadFile.mockRejectedValueOnce(err);

    const loader = new ProfileLoader("/tmp/profiles");
    await expect(loader.load("forbidden")).rejects.toThrow("Failed to read business profile");
  });

  it("throws on invalid JSON", async () => {
    mockedReadFile.mockResolvedValueOnce("not valid json{{{" as never);

    const loader = new ProfileLoader("/tmp/profiles");
    await expect(loader.load("bad")).rejects.toThrow("Invalid JSON");
  });

  it("throws on schema validation failure", async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ id: "test-profile" }) as never);

    const loader = new ProfileLoader("/tmp/profiles");
    await expect(loader.load("test-profile")).rejects.toThrow("Business profile validation failed");
  });

  it("throws on profile ID mismatch", async () => {
    const profile = makeValidProfile({ id: "different-id" });
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(profile) as never);

    const loader = new ProfileLoader("/tmp/profiles");
    await expect(loader.load("test-profile")).rejects.toThrow("Business profile ID mismatch");
  });

  it("loads and validates a valid profile", async () => {
    const profile = makeValidProfile();
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(profile) as never);

    const loader = new ProfileLoader("/tmp/profiles");
    const result = await loader.load("test-profile");
    expect(result.id).toBe("test-profile");
    expect(result.name).toBe("Test Business");
  });

  it("caches loaded profiles", async () => {
    const profile = makeValidProfile();
    mockedReadFile.mockResolvedValue(JSON.stringify(profile) as never);

    const loader = new ProfileLoader("/tmp/profiles");
    const first = await loader.load("test-profile");
    const second = await loader.load("test-profile");
    expect(first).toBe(second);
    expect(mockedReadFile).toHaveBeenCalledTimes(1);
  });

  it("clears cache for specific profile", async () => {
    const profile = makeValidProfile();
    mockedReadFile.mockResolvedValue(JSON.stringify(profile) as never);

    const loader = new ProfileLoader("/tmp/profiles");
    await loader.load("test-profile");
    loader.clearCache("test-profile");
    await loader.load("test-profile");
    expect(mockedReadFile).toHaveBeenCalledTimes(2);
  });

  it("clears entire cache", async () => {
    const profile = makeValidProfile();
    mockedReadFile.mockResolvedValue(JSON.stringify(profile) as never);

    const loader = new ProfileLoader("/tmp/profiles");
    await loader.load("test-profile");
    loader.clearCache();
    await loader.load("test-profile");
    expect(mockedReadFile).toHaveBeenCalledTimes(2);
  });
});

// ── ProfileResolver Tests ──

describe("ProfileResolver", () => {
  it("resolves a minimal profile with defaults", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile();
    const resolved = resolver.resolve(profile);

    expect(resolved.profile).toBe(profile);
    expect(resolved.journey).toBe(profile.journey);
    expect(resolved.objectionTrees).toEqual([]);
    expect(resolved.cadenceTemplates).toEqual([]);
  });

  it("applies default scoring when not specified", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile();
    const resolved = resolver.resolve(profile);

    expect(resolved.scoring.referralValue).toBe(200);
    expect(resolved.scoring.noShowCost).toBe(75);
    expect(resolved.scoring.retentionDecayRate).toBe(0.85);
    expect(resolved.scoring.projectionYears).toBe(5);
    expect(resolved.scoring.leadScoreWeights).toBeDefined();
  });

  it("merges partial scoring with defaults", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile({
      scoring: { referralValue: 500, noShowCost: 100 },
    });
    const resolved = resolver.resolve(profile);

    expect(resolved.scoring.referralValue).toBe(500);
    expect(resolved.scoring.noShowCost).toBe(100);
    expect(resolved.scoring.retentionDecayRate).toBe(0.85); // default
    expect(resolved.scoring.projectionYears).toBe(5); // default
  });

  it("merges partial leadScoreWeights with defaults", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile({
      scoring: { leadScoreWeights: { serviceValue: 30 } },
    });
    const resolved = resolver.resolve(profile);

    expect(resolved.scoring.leadScoreWeights.serviceValue).toBe(30);
    expect(resolved.scoring.leadScoreWeights.urgency).toBe(15); // default
  });

  it("applies default compliance flags when not specified", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile();
    const resolved = resolver.resolve(profile);

    expect(resolved.compliance.enableHipaaRedactor).toBe(false);
    expect(resolved.compliance.enableMedicalClaimFilter).toBe(false);
    expect(resolved.compliance.enableConsentGate).toBe(false);
  });

  it("preserves compliance flags when specified", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile({
      compliance: {
        enableHipaaRedactor: true,
        enableConsentGate: true,
      },
    });
    const resolved = resolver.resolve(profile);

    expect(resolved.compliance.enableHipaaRedactor).toBe(true);
    expect(resolved.compliance.enableMedicalClaimFilter).toBe(false); // default
    expect(resolved.compliance.enableConsentGate).toBe(true);
  });

  it("applies default LLM context when not specified", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile();
    const resolved = resolver.resolve(profile);

    expect(resolved.llmContext.systemPromptExtension).toBe("");
    expect(resolved.llmContext.persona).toBe("");
    expect(resolved.llmContext.tone).toBe("");
    expect(resolved.llmContext.bannedTopics).toEqual([]);
  });

  it("preserves LLM context when specified", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile({
      llmContext: {
        persona: "helpful assistant",
        tone: "professional",
        bannedTopics: ["politics"],
      },
    });
    const resolved = resolver.resolve(profile);

    expect(resolved.llmContext.persona).toBe("helpful assistant");
    expect(resolved.llmContext.tone).toBe("professional");
    expect(resolved.llmContext.bannedTopics).toEqual(["politics"]);
    expect(resolved.llmContext.systemPromptExtension).toBe(""); // default
  });

  it("passes through objection trees from profile", () => {
    const resolver = new ProfileResolver();
    const trees = [
      {
        category: "price",
        keywords: ["expensive"],
        response: "We offer plans.",
        followUp: "Interested?",
      },
    ];
    const profile = makeValidProfile({ objectionTrees: trees });
    const resolved = resolver.resolve(profile);

    expect(resolved.objectionTrees).toEqual(trees);
  });

  it("passes through cadence templates from profile", () => {
    const resolver = new ProfileResolver();
    const templates = [
      {
        id: "t1",
        name: "Test",
        trigger: "booked",
        steps: [{ actionType: "customer-engagement.reminder.send", delayMs: 0 }],
      },
    ];
    const profile = makeValidProfile({ cadenceTemplates: templates });
    const resolved = resolver.resolve(profile);

    expect(resolved.cadenceTemplates).toEqual(templates);
  });

  it("builds system prompt fragment with business info", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile({
      business: {
        name: "Test Biz",
        type: "dental",
        tagline: "Best dentist",
      },
    });
    const resolved = resolver.resolve(profile);

    expect(resolved.systemPromptFragment).toContain("Business: Test Biz");
    expect(resolved.systemPromptFragment).toContain("Type: dental");
    expect(resolved.systemPromptFragment).toContain("Tagline: Best dentist");
  });

  it("includes services in system prompt fragment", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile();
    const resolved = resolver.resolve(profile);

    expect(resolved.systemPromptFragment).toContain("Services:");
    expect(resolved.systemPromptFragment).toContain("Service One");
  });

  it("includes team in system prompt fragment when present", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile({
      team: [{ id: "t1", name: "Dr. Test", role: "Lead", specialties: ["surgery"] }],
    });
    const resolved = resolver.resolve(profile);

    expect(resolved.systemPromptFragment).toContain("Team:");
    expect(resolved.systemPromptFragment).toContain("Dr. Test, Lead");
    expect(resolved.systemPromptFragment).toContain("surgery");
  });

  it("includes policies in system prompt fragment when present", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile({
      policies: [{ topic: "Cancellation", content: "24hr notice required." }],
    });
    const resolved = resolver.resolve(profile);

    expect(resolved.systemPromptFragment).toContain("Policies:");
    expect(resolved.systemPromptFragment).toContain("Cancellation: 24hr notice required.");
  });

  it("includes hours in system prompt fragment when present", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile({
      hours: { monday: { open: "09:00", close: "17:00" } },
    });
    const resolved = resolver.resolve(profile);

    expect(resolved.systemPromptFragment).toContain("Hours:");
    expect(resolved.systemPromptFragment).toContain("monday: 09:00 - 17:00");
  });

  it("omits optional sections from system prompt when absent", () => {
    const resolver = new ProfileResolver();
    const profile = makeValidProfile();
    const resolved = resolver.resolve(profile);

    expect(resolved.systemPromptFragment).not.toContain("Team:");
    expect(resolved.systemPromptFragment).not.toContain("Policies:");
    expect(resolved.systemPromptFragment).not.toContain("Hours:");
  });
});
