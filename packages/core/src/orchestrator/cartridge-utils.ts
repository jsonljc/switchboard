/**
 * Infer cartridge ID from action type prefix by matching against
 * registered cartridge IDs. Falls back to null if no match found.
 * e.g. "ads.campaign.pause" -> matches cartridge "ads-spend" if its
 * manifest declares an action with that type.
 */
export function inferCartridgeId(
  actionType: string,
  registry?: import("../storage/interfaces.js").CartridgeRegistry,
): string | null {
  if (!registry) return null;

  const prefix = actionType.split(".")[0];
  if (!prefix) return null;

  for (const cartridgeId of registry.list()) {
    const cartridge = registry.get(cartridgeId);
    if (!cartridge) continue;

    const manifest = cartridge.manifest;
    if (manifest.actions) {
      for (const action of manifest.actions) {
        if (actionType === action.actionType) return cartridgeId;
        const actionPrefix = action.actionType.split(".")[0];
        if (actionPrefix && actionPrefix === prefix) return cartridgeId;
      }
    }
  }

  return null;
}
