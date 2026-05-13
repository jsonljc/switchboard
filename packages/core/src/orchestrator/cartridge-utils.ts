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
