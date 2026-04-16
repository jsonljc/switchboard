import type { ContextRequirement, KnowledgeKind } from "@switchboard/schemas";
import { ContextResolutionError } from "./types.js";

export interface ContextResolutionMeta {
  injectAs: string;
  kind: KnowledgeKind;
  scope: string;
  entriesFound: number;
  totalChars: number;
}

export interface ResolvedContext {
  variables: Record<string, string>;
  metadata: ContextResolutionMeta[];
}

interface KnowledgeEntryRow {
  kind: KnowledgeKind;
  scope: string;
  content: string;
  priority: number;
  updatedAt: Date;
}

export interface KnowledgeEntryStoreForResolver {
  findActive(
    orgId: string,
    filters: Array<{ kind: KnowledgeKind; scope: string }>,
  ): Promise<KnowledgeEntryRow[]>;
}

export class ContextResolverImpl {
  constructor(private store: KnowledgeEntryStoreForResolver) {}

  async resolve(orgId: string, requirements: ContextRequirement[]): Promise<ResolvedContext> {
    if (requirements.length === 0) {
      return { variables: {}, metadata: [] };
    }

    const filters = requirements.map((r) => ({ kind: r.kind, scope: r.scope }));
    const entries = await this.store.findActive(orgId, filters);

    const grouped = new Map<string, KnowledgeEntryRow[]>();
    for (const entry of entries) {
      const key = `${entry.kind}::${entry.scope}`;
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    }

    const variables: Record<string, string> = {};
    const metadata: ContextResolutionMeta[] = [];

    for (const req of requirements) {
      const key = `${req.kind}::${req.scope}`;
      const group = grouped.get(key) ?? [];

      const concatenated = group.map((e) => e.content).join("\n---\n");

      if (group.length === 0 && req.required) {
        throw new ContextResolutionError(req.kind, req.scope);
      }

      if (group.length > 0) {
        variables[req.injectAs] = concatenated;
      }

      metadata.push({
        injectAs: req.injectAs,
        kind: req.kind,
        scope: req.scope,
        entriesFound: group.length,
        totalChars: concatenated.length,
      });
    }

    return { variables, metadata };
  }
}
