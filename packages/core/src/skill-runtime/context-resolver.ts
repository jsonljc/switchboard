import type { ContextRequirement, KnowledgeKind, BusinessFacts } from "@switchboard/schemas";
import { ContextResolutionError } from "./types.js";

export interface ContextResolutionConfig {
  maxCharsPerRequirement: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextResolutionConfig = {
  maxCharsPerRequirement: 4000,
};

export interface BusinessFactsStoreForResolver {
  get(orgId: string): Promise<BusinessFacts | null>;
}

export function renderBusinessFacts(facts: BusinessFacts): string {
  const lines: string[] = [];
  lines.push(`Business: ${facts.businessName}`);
  lines.push(`Timezone: ${facts.timezone}`);

  for (const loc of facts.locations) {
    lines.push(`Location: ${loc.name} — ${loc.address}`);
    if (loc.parkingNotes) lines.push(`  Parking: ${loc.parkingNotes}`);
    if (loc.accessNotes) lines.push(`  Access: ${loc.accessNotes}`);
  }

  lines.push("Hours:");
  for (const [day, hours] of Object.entries(facts.openingHours)) {
    if (hours.closed) {
      lines.push(`  ${day}: closed`);
    } else {
      lines.push(`  ${day}: ${hours.open}–${hours.close}`);
    }
  }

  lines.push("Services:");
  for (const svc of facts.services) {
    let line = `  ${svc.name}: ${svc.description}`;
    if (svc.durationMinutes) line += ` (${svc.durationMinutes} min)`;
    if (svc.price) line += ` — ${svc.price} ${svc.currency}`;
    lines.push(line);
  }

  if (facts.bookingPolicies) {
    const bp = facts.bookingPolicies;
    if (bp.cancellationPolicy) lines.push(`Cancellation: ${bp.cancellationPolicy}`);
    if (bp.reschedulePolicy) lines.push(`Reschedule: ${bp.reschedulePolicy}`);
    if (bp.noShowPolicy) lines.push(`No-show: ${bp.noShowPolicy}`);
    if (bp.prepInstructions) lines.push(`Prep: ${bp.prepInstructions}`);
  }

  lines.push(
    `Escalation: ${facts.escalationContact.name} (${facts.escalationContact.channel}: ${facts.escalationContact.address})`,
  );

  if (facts.additionalFaqs.length > 0) {
    lines.push("FAQs:");
    for (const faq of facts.additionalFaqs) {
      lines.push(`  Q: ${faq.question}`);
      lines.push(`  A: ${faq.answer}`);
    }
  }

  return lines.join("\n");
}

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
  private businessFactsStore: BusinessFactsStoreForResolver | null;

  constructor(
    private store: KnowledgeEntryStoreForResolver,
    configOrFactsStore?: Partial<ContextResolutionConfig> | BusinessFactsStoreForResolver,
    businessFactsStore?: BusinessFactsStoreForResolver,
  ) {
    // Disambiguate second param: if it has a 'get' function it's a BusinessFactsStore
    if (
      configOrFactsStore &&
      typeof (configOrFactsStore as BusinessFactsStoreForResolver).get === "function"
    ) {
      this.config = { ...DEFAULT_CONTEXT_CONFIG };
      this.businessFactsStore = configOrFactsStore as BusinessFactsStoreForResolver;
    } else {
      this.config = {
        ...DEFAULT_CONTEXT_CONFIG,
        ...(configOrFactsStore as Partial<ContextResolutionConfig> | undefined),
      };
      this.businessFactsStore = businessFactsStore ?? null;
    }
  }

  async resolve(orgId: string, requirements: ContextRequirement[]): Promise<ResolvedContext> {
    if (requirements.length === 0) {
      return { variables: {}, metadata: [] };
    }

    // Separate business-facts requirements from knowledge-entry requirements
    const businessFactsReqs = requirements.filter((r) => r.kind === "business-facts");
    const knowledgeReqs = requirements.filter((r) => r.kind !== "business-facts");

    const variables: Record<string, string> = {};
    const metadata: ContextResolutionMeta[] = [];

    // Handle business-facts via dedicated store
    for (const req of businessFactsReqs) {
      if (this.businessFactsStore) {
        const facts = await this.businessFactsStore.get(orgId);
        if (facts) {
          const rendered = renderBusinessFacts(facts);
          variables[req.injectAs] = rendered;
          metadata.push({
            injectAs: req.injectAs,
            kind: req.kind,
            scope: req.scope,
            entriesFound: 1,
            totalChars: rendered.length,
            wasTruncated: false,
            originalChars: rendered.length,
          });
        } else if (req.required) {
          throw new ContextResolutionError(req.kind, req.scope);
        } else {
          metadata.push({
            injectAs: req.injectAs,
            kind: req.kind,
            scope: req.scope,
            entriesFound: 0,
            totalChars: 0,
            wasTruncated: false,
            originalChars: 0,
          });
        }
      } else if (req.required) {
        throw new ContextResolutionError(req.kind, req.scope);
      }
    }

    if (knowledgeReqs.length === 0) {
      return { variables, metadata };
    }

    const filters = knowledgeReqs.map((r) => ({ kind: r.kind, scope: r.scope }));
    const entries = await this.store.findActive(orgId, filters);

    const grouped = new Map<string, KnowledgeEntryRow[]>();
    for (const entry of entries) {
      const key = `${entry.kind}::${entry.scope}`;
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    }

    for (const req of knowledgeReqs) {
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
