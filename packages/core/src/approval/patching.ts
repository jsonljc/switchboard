export function applyPatch(
  originalParams: Record<string, unknown>,
  patchValue: Record<string, unknown>,
): Record<string, unknown> {
  return { ...originalParams, ...patchValue };
}

export function describePatch(
  originalParams: Record<string, unknown>,
  patchValue: Record<string, unknown>,
): string {
  const changes: string[] = [];

  for (const [key, newVal] of Object.entries(patchValue)) {
    const oldVal = originalParams[key];
    if (oldVal !== newVal) {
      changes.push(`${key}: ${String(oldVal)} -> ${String(newVal)}`);
    }
  }

  return changes.length > 0
    ? `Modified: ${changes.join(", ")}`
    : "No changes applied";
}
