import type {
  SkinManifest,
  SkinGovernance,
  SkinLanguage,
  SkinPlaybook,
} from "@switchboard/schemas";
import type { ToolFilter, RegisteredTool } from "../tool-registry/types.js";
import type { ToolRegistry } from "../tool-registry/index.js";
import {
  GOVERNANCE_PROFILE_PRESETS,
  type GovernanceProfilePreset,
} from "../identity/governance-presets.js";

/** Resolved skin configuration ready for use by apps. */
export interface ResolvedSkin {
  /** The original skin manifest. */
  manifest: SkinManifest;
  /** Tool filter derived from the skin's tools config. */
  toolFilter: ToolFilter;
  /** Filtered tools (only available after calling resolveTools). */
  tools: RegisteredTool[];
  /** Governance preset for the skin's profile. */
  governancePreset: GovernanceProfilePreset;
  /** Governance config from the skin (policies, spend limits, approval routing). */
  governance: SkinGovernance;
  /** Language config (locale, prompts, templates, terminology). */
  language: SkinLanguage;
  /** Playbooks defined by the skin. */
  playbooks: SkinPlaybook[];
  /** Primary channel for the skin. */
  primaryChannel: string | null;
  /** Required cartridge IDs. */
  requiredCartridges: string[];
}

/**
 * Resolves a SkinManifest into a configuration object usable by apps.
 *
 * - Converts tools config into a ToolFilter and applies it to the registry
 * - Resolves governance profile to a preset
 * - Validates required cartridges are registered
 *
 * Usage:
 *   const resolver = new SkinResolver();
 *   const resolved = resolver.resolve(skinManifest, toolRegistry);
 */
export class SkinResolver {
  /**
   * Resolve a skin manifest into a fully usable configuration.
   * Throws if required cartridges are not registered in the tool registry.
   */
  resolve(manifest: SkinManifest, registry: ToolRegistry): ResolvedSkin {
    // 1. Build tool filter from skin config
    const toolFilter: ToolFilter = {
      include: manifest.tools.include,
      exclude: manifest.tools.exclude,
      aliases: manifest.tools.aliases,
    };

    // 2. Get filtered tools from registry
    const tools = registry.getFilteredTools(toolFilter);

    // 3. Validate required cartridges are registered
    const registeredCartridgeIds = new Set(registry.getCartridgeIds());
    const missingCartridges = manifest.requiredCartridges.filter(
      (id) => !registeredCartridgeIds.has(id),
    );
    if (missingCartridges.length > 0) {
      throw new Error(
        `Skin "${manifest.id}" requires cartridges that are not registered: ${missingCartridges.join(", ")}`,
      );
    }

    // 4. Resolve governance profile to preset
    const governancePreset = GOVERNANCE_PROFILE_PRESETS[manifest.governance.profile];

    // 5. Apply skin spend limits on top of preset defaults
    const mergedPreset = { ...governancePreset };
    if (manifest.governance.spendLimits) {
      const sl = manifest.governance.spendLimits;
      mergedPreset.spendLimits = {
        daily: sl.dailyUsd ?? governancePreset.spendLimits.daily,
        weekly: sl.weeklyUsd ?? governancePreset.spendLimits.weekly,
        monthly: sl.monthlyUsd ?? governancePreset.spendLimits.monthly,
        perAction: governancePreset.spendLimits.perAction,
      };
    }

    return {
      manifest,
      toolFilter,
      tools,
      governancePreset: mergedPreset,
      governance: manifest.governance,
      language: manifest.language,
      playbooks: manifest.playbooks ?? [],
      primaryChannel: manifest.channels?.primary ?? null,
      requiredCartridges: manifest.requiredCartridges,
    };
  }
}
