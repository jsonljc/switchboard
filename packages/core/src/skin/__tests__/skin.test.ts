import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkinLoader } from "../loader.js";
import { SkinResolver } from "../resolver.js";
import { ToolRegistry } from "../../tool-registry/index.js";
import type { SkinManifest, CartridgeManifest } from "@switchboard/schemas";

// ── Mock fs/promises globally for SkinLoader tests ──
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
const mockedReadFile = vi.mocked(readFile);

// ── Test Data ──

function makeValidSkin(overrides?: Partial<SkinManifest>): SkinManifest {
  return {
    id: "test-skin",
    name: "Test Skin",
    version: "1.0.0",
    description: "A test skin",
    tools: {
      include: ["crm.*"],
    },
    governance: {
      profile: "guarded",
    },
    language: {
      locale: "en",
    },
    requiredCartridges: ["crm"],
    ...overrides,
  };
}

function makeManifest(id: string, actions: string[]): CartridgeManifest {
  return {
    id,
    name: id,
    description: `${id} cartridge`,
    version: "1.0.0",
    actions: actions.map((actionType) => ({
      actionType,
      name: actionType,
      description: `Action ${actionType}`,
      parametersSchema: {},
      baseRiskCategory: "low" as const,
      reversible: false,
    })),
    requiredConnections: [],
    defaultPolicies: [],
  };
}

// ── SkinLoader Tests ──

describe("SkinLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when skin file does not exist", async () => {
    const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockedReadFile.mockRejectedValueOnce(err);

    const loader = new SkinLoader("/tmp/skins");
    await expect(loader.load("missing")).rejects.toThrow("Skin manifest not found");
  });

  it("throws on non-ENOENT file errors", async () => {
    const err = new Error("Permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    mockedReadFile.mockRejectedValueOnce(err);

    const loader = new SkinLoader("/tmp/skins");
    await expect(loader.load("forbidden")).rejects.toThrow("Failed to read skin manifest");
  });

  it("throws on invalid JSON", async () => {
    mockedReadFile.mockResolvedValueOnce("not valid json{{{" as never);

    const loader = new SkinLoader("/tmp/skins");
    await expect(loader.load("bad")).rejects.toThrow("Invalid JSON");
  });

  it("throws on schema validation failure", async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ id: "test-skin" }) as never);

    const loader = new SkinLoader("/tmp/skins");
    await expect(loader.load("test-skin")).rejects.toThrow("Skin manifest validation failed");
  });

  it("throws on skin ID mismatch", async () => {
    const skin = makeValidSkin({ id: "different-id" });
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(skin) as never);

    const loader = new SkinLoader("/tmp/skins");
    await expect(loader.load("test-skin")).rejects.toThrow("Skin manifest ID mismatch");
  });

  it("loads and validates a valid skin", async () => {
    const skin = makeValidSkin();
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(skin) as never);

    const loader = new SkinLoader("/tmp/skins");
    const result = await loader.load("test-skin");
    expect(result.id).toBe("test-skin");
    expect(result.name).toBe("Test Skin");
  });

  it("caches loaded skins", async () => {
    const skin = makeValidSkin();
    mockedReadFile.mockResolvedValue(JSON.stringify(skin) as never);

    const loader = new SkinLoader("/tmp/skins");
    const first = await loader.load("test-skin");
    const second = await loader.load("test-skin");
    expect(first).toBe(second);
    expect(mockedReadFile).toHaveBeenCalledTimes(1);
  });

  it("clears cache for specific skin", async () => {
    const skin = makeValidSkin();
    mockedReadFile.mockResolvedValue(JSON.stringify(skin) as never);

    const loader = new SkinLoader("/tmp/skins");
    await loader.load("test-skin");
    loader.clearCache("test-skin");
    await loader.load("test-skin");
    expect(mockedReadFile).toHaveBeenCalledTimes(2);
  });

  it("clears entire cache", async () => {
    const skin = makeValidSkin();
    mockedReadFile.mockResolvedValue(JSON.stringify(skin) as never);

    const loader = new SkinLoader("/tmp/skins");
    await loader.load("test-skin");
    loader.clearCache();
    await loader.load("test-skin");
    expect(mockedReadFile).toHaveBeenCalledTimes(2);
  });
});

// ── SkinResolver Tests ──

describe("SkinResolver", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.registerCartridge(
      "crm",
      makeManifest("crm", ["crm.contact.search", "crm.contact.create", "crm.deal.list"]),
    );
    registry.registerCartridge(
      "digital-ads",
      makeManifest("digital-ads", ["digital-ads.campaign.create", "digital-ads.campaign.pause"]),
    );
    registry.registerCartridge(
      "patient-engagement",
      makeManifest("patient-engagement", [
        "patient-engagement.appointment.book",
        "patient-engagement.appointment.cancel",
        "patient-engagement.reminder.send",
      ]),
    );
  });

  it("filters tools by include patterns", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      tools: { include: ["crm.*"] },
      requiredCartridges: ["crm"],
    });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.tools).toHaveLength(3);
    expect(resolved.tools.every((t) => t.actionType.startsWith("crm."))).toBe(true);
  });

  it("excludes tools matching exclude patterns", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      tools: {
        include: ["crm.*"],
        exclude: ["crm.deal.*"],
      },
      requiredCartridges: ["crm"],
    });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.tools).toHaveLength(2);
    expect(resolved.tools.some((t) => t.actionType === "crm.deal.list")).toBe(false);
  });

  it("applies tool aliases", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      tools: {
        include: ["crm.*"],
        aliases: { search_contacts: "crm.contact.search" },
      },
      requiredCartridges: ["crm"],
    });

    const resolved = resolver.resolve(skin, registry);
    const aliasedTool = resolved.tools.find((t) => t.actionType === "crm.contact.search");
    expect(aliasedTool?.alias).toBe("search_contacts");
  });

  it("throws when required cartridge is missing", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      requiredCartridges: ["crm", "nonexistent"],
    });

    expect(() => resolver.resolve(skin, registry)).toThrow(
      'Skin "test-skin" requires cartridges that are not registered: nonexistent',
    );
  });

  it("resolves governance profile to preset", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      governance: { profile: "strict" },
      requiredCartridges: ["crm"],
    });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.governancePreset.riskTolerance.high).toBe("mandatory");
  });

  it("merges skin spend limits with preset", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      governance: {
        profile: "guarded",
        spendLimits: { dailyUsd: 500, weeklyUsd: 2000 },
      },
      requiredCartridges: ["crm"],
    });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.governancePreset.spendLimits.daily).toBe(500);
    expect(resolved.governancePreset.spendLimits.weekly).toBe(2000);
    // perAction should come from the guarded preset
    expect(resolved.governancePreset.spendLimits.perAction).toBe(5000);
  });

  it("resolves language config", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      language: {
        locale: "es",
        terminology: { campaign: "campaña" },
        interpreterSystemPrompt: "You are a Spanish assistant.",
      },
      requiredCartridges: ["crm"],
    });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.language.locale).toBe("es");
    expect(resolved.language.terminology?.campaign).toBe("campaña");
    expect(resolved.language.interpreterSystemPrompt).toBe("You are a Spanish assistant.");
  });

  it("resolves playbooks", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      playbooks: [
        {
          id: "new-contact",
          name: "New Contact",
          trigger: "add a new contact",
          steps: [{ actionType: "crm.contact.create" }],
        },
      ],
      requiredCartridges: ["crm"],
    });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.playbooks).toHaveLength(1);
    expect(resolved.playbooks[0]!.id).toBe("new-contact");
  });

  it("resolves primary channel", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      channels: { primary: "whatsapp", enabled: ["whatsapp", "telegram"] },
      requiredCartridges: ["crm"],
    });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.primaryChannel).toBe("whatsapp");
  });

  it("returns null primary channel when not set", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({ requiredCartridges: ["crm"] });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.primaryChannel).toBeNull();
  });

  it("multi-cartridge skin filters correctly", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({
      tools: { include: ["crm.*", "patient-engagement.*"] },
      requiredCartridges: ["crm", "patient-engagement"],
    });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.tools).toHaveLength(6); // 3 crm + 3 patient-engagement
    expect(resolved.tools.some((t) => t.actionType.startsWith("digital-ads"))).toBe(false);
  });

  it("provides the original manifest in resolved skin", () => {
    const resolver = new SkinResolver();
    const skin = makeValidSkin({ requiredCartridges: ["crm"] });

    const resolved = resolver.resolve(skin, registry);
    expect(resolved.manifest).toBe(skin);
  });
});
