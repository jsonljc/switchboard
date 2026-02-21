import type { ResolvedEntity } from "@switchboard/schemas";

export interface EntityResolver {
  resolve(
    inputRef: string,
    entityType: string,
    context: Record<string, unknown>,
  ): Promise<ResolvedEntity>;
}

export interface ResolverResult {
  resolved: ResolvedEntity[];
  ambiguous: ResolvedEntity[];
  notFound: ResolvedEntity[];
}

export async function resolveEntities(
  refs: Array<{ inputRef: string; entityType: string }>,
  resolver: EntityResolver,
  context: Record<string, unknown>,
): Promise<ResolverResult> {
  const result: ResolverResult = {
    resolved: [],
    ambiguous: [],
    notFound: [],
  };

  for (const ref of refs) {
    const entity = await resolver.resolve(ref.inputRef, ref.entityType, context);

    switch (entity.status) {
      case "resolved":
        result.resolved.push(entity);
        break;
      case "ambiguous":
        result.ambiguous.push(entity);
        break;
      case "not_found":
        result.notFound.push(entity);
        break;
    }
  }

  return result;
}

export function buildClarificationQuestion(ambiguous: ResolvedEntity[]): string {
  if (ambiguous.length === 0) return "";

  const lines = ambiguous.map((entity) => {
    const altList = entity.alternatives
      .map((alt, i) => `  ${i + 1}. ${alt.name} (${alt.id})`)
      .join("\n");
    return `Which "${entity.inputRef}" did you mean?\n${altList}`;
  });

  return lines.join("\n\n");
}

export function buildNotFoundExplanation(notFound: ResolvedEntity[]): string {
  if (notFound.length === 0) return "";

  const refs = notFound.map((e) => `"${e.inputRef}"`).join(", ");
  return `Could not find: ${refs}. Please check the name and try again.`;
}
