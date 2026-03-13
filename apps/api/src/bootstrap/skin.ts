import type { FastifyBaseLogger } from "fastify";
import { SkinLoader, SkinResolver, ToolRegistry, ProfileResolver } from "@switchboard/core";
import type {
  StorageContext,
  ResolvedSkin,
  ResolvedProfile,
  GovernanceProfileStore,
} from "@switchboard/core";
import type { Policy } from "@switchboard/schemas";
import type { BusinessProfile } from "@switchboard/schemas";

/**
 * Load and resolve a skin from the skins directory, apply governance profile
 * and policy overrides.
 */
export async function loadAndApplySkin(
  skinId: string,
  storage: StorageContext,
  governanceProfileStore: GovernanceProfileStore,
  logger: FastifyBaseLogger,
): Promise<ResolvedSkin> {
  const skinsDir = new URL("../../../../skins", import.meta.url).pathname;
  const skinLoader = new SkinLoader(skinsDir);
  const skinResolver = new SkinResolver();
  const toolRegistry = new ToolRegistry();

  for (const cartridgeId of storage.cartridges.list()) {
    const cartridge = storage.cartridges.get(cartridgeId);
    if (cartridge) {
      toolRegistry.registerCartridge(cartridgeId, cartridge.manifest);
    }
  }

  const skin = await skinLoader.load(skinId);
  const resolvedSkin = skinResolver.resolve(skin, toolRegistry);
  logger.info(
    { skinId, tools: resolvedSkin.tools.length, profile: resolvedSkin.governance.profile },
    `Skin "${skinId}" loaded: ${resolvedSkin.tools.length} tools, profile=${resolvedSkin.governance.profile}`,
  );

  // Apply skin governance profile and seed policy overrides
  await governanceProfileStore.set(null, resolvedSkin.governance.profile);
  logger.info(
    { profile: resolvedSkin.governance.profile },
    "Skin governance profile set as global default",
  );

  if (resolvedSkin.governance.policyOverrides?.length) {
    const now = new Date();
    for (let i = 0; i < resolvedSkin.governance.policyOverrides.length; i++) {
      const override = resolvedSkin.governance.policyOverrides[i]!;
      const approvalRequirement =
        override.effect === "require_approval"
          ? ((override.effectParams?.["approvalRequirement"] as Policy["approvalRequirement"]) ??
            "standard")
          : undefined;

      await storage.policies.save({
        id: `skin_${resolvedSkin.manifest.id}_${i}`,
        name: override.name,
        description: override.description ?? `Skin policy: ${override.name}`,
        organizationId: null,
        cartridgeId: null,
        priority: 9000 + i,
        active: true,
        rule: override.rule as Policy["rule"],
        effect: override.effect,
        effectParams: override.effectParams ?? {},
        approvalRequirement,
        createdAt: now,
        updatedAt: now,
      });
    }
    logger.info(
      { count: resolvedSkin.governance.policyOverrides.length },
      "Skin policy overrides seeded",
    );
  }

  return resolvedSkin;
}

/**
 * Resolve a business profile for agent context.
 */
export function resolveBusinessProfile(
  businessProfile: BusinessProfile,
  logger: FastifyBaseLogger,
): ResolvedProfile {
  const profileResolver = new ProfileResolver();
  const resolved = profileResolver.resolve(businessProfile);
  logger.info({ profileId: businessProfile.id }, "Business profile resolved for agent context");
  return resolved;
}
