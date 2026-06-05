// Provider-prefixed identity refs (slice-3 spec 3.5): the avatar id rides
// CreatorIdentity.identityRefIds as `heygen:<avatar_id>` (no migration; a
// typed field arrives if a second identity-requiring provider ever lands).
interface CreatorWithRefs {
  identityRefIds?: string[];
}

export function getProviderRef(creator: CreatorWithRefs, provider: string): string | undefined {
  const prefix = `${provider}:`;
  for (const ref of creator.identityRefIds ?? []) {
    if (ref.startsWith(prefix)) {
      const id = ref.slice(prefix.length);
      if (id.length > 0) return id;
    }
  }
  return undefined;
}
