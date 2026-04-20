import type { ContextRequirement, KnowledgeKind } from "@switchboard/schemas";
import { ContextResolutionError } from "./types.js";

export interface ContextResolutionConfig {
  maxCharsPerRequirement: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextResolutionConfig = {
  maxCharsPerRequirement: 4000,
};

export interface ContextResolutionMeta {
  injectAs: string;
  kind: KnowledgeKind;
  scope: string;
  entriesFound: number;
  totalChars: number;
  wasTruncated: boolean;
  originalChars: number;
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
  private config: ContextResolutionConfig;

  constructor(
    private store: KnowledgeEntryStoreForResolver,
    config?: Partial<ContextResolutionConfig>,
  ) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
  }

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

      if (group.length === 0 && req.required) {
        throw new ContextResolutionError(req.kind, req.scope);
      }

      // Sort by priority DESC, then updatedAt DESC for tiebreaker
      group.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });

      // Compute full concatenation length for originalChars
      const fullConcatenated = group.map((e) => e.content).join("\n---\n");
      const originalChars = fullConcatenated.length;

      // Truncate at entry boundaries
      const cap = this.config.maxCharsPerRequirement;
      const included: string[] = [];
      let currentLength = 0;
      let omittedCount = 0;

      for (let i = 0; i < group.length; i++) {
        const entry = group[i]!;
        const separatorLen = included.length > 0 ? 5 : 0; // "\n---\n".length
        const wouldBe = currentLength + separatorLen + entry.content.length;

        if (i === 0) {
          // First entry always included
          included.push(entry.content);
          currentLength = entry.content.length;
        } else if (wouldBe <= cap) {
          included.push(entry.content);
          currentLength = wouldBe;
        } else {
          omittedCount = group.length - i;
          break;
        }
      }

      let concatenated = included.join("\n---\n");
      const wasTruncated = omittedCount > 0;

      if (wasTruncated) {
        concatenated += `\n[... truncated; ${omittedCount} additional entries omitted; original length ${originalChars} chars]`;
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
        wasTruncated,
        originalChars,
      });
    }

    return { variables, metadata };
  }
}
