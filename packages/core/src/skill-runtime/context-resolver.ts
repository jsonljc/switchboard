import type { ContextRequirement, KnowledgeKind, BusinessFacts } from "@switchboard/schemas";
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

export interface BusinessFactsStoreForResolver {
  get(organizationId: string): Promise<BusinessFacts | null>;
}

export class ContextResolverImpl {
  constructor(
    private store: KnowledgeEntryStoreForResolver,
    private businessFactsStore?: BusinessFactsStoreForResolver,
  ) {}

  async resolve(orgId: string, requirements: ContextRequirement[]): Promise<ResolvedContext> {
    if (requirements.length === 0) {
      return { variables: {}, metadata: [] };
    }

    const businessFactsReqs = requirements.filter((r) => r.kind === "business-facts");
    const knowledgeReqs = requirements.filter((r) => r.kind !== "business-facts");

    const variables: Record<string, string> = {};
    const metadata: ContextResolutionMeta[] = [];

    if (businessFactsReqs.length > 0) {
      await this.resolveBusinessFacts(orgId, businessFactsReqs, variables, metadata);
    }

    if (knowledgeReqs.length > 0) {
      await this.resolveKnowledge(orgId, knowledgeReqs, variables, metadata);
    }

    return { variables, metadata };
  }

  private async resolveBusinessFacts(
    orgId: string,
    reqs: ContextRequirement[],
    variables: Record<string, string>,
    metadata: ContextResolutionMeta[],
  ): Promise<void> {
    const facts = this.businessFactsStore ? await this.businessFactsStore.get(orgId) : null;

    for (const req of reqs) {
      if (!facts) {
        if (req.required) {
          throw new ContextResolutionError(req.kind, req.scope);
        }
        metadata.push({
          injectAs: req.injectAs,
          kind: req.kind,
          scope: req.scope,
          entriesFound: 0,
          totalChars: 0,
        });
        continue;
      }

      const rendered = renderBusinessFacts(facts);
      variables[req.injectAs] = rendered;
      metadata.push({
        injectAs: req.injectAs,
        kind: req.kind,
        scope: req.scope,
        entriesFound: 1,
        totalChars: rendered.length,
      });
    }
  }

  private async resolveKnowledge(
    orgId: string,
    reqs: ContextRequirement[],
    variables: Record<string, string>,
    metadata: ContextResolutionMeta[],
  ): Promise<void> {
    const filters = reqs.map((r) => ({ kind: r.kind, scope: r.scope }));
    const entries = await this.store.findActive(orgId, filters);

    const grouped = new Map<string, KnowledgeEntryRow[]>();
    for (const entry of entries) {
      const key = `${entry.kind}::${entry.scope}`;
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    }

    for (const req of reqs) {
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
  }
}

export function renderBusinessFacts(facts: BusinessFacts): string {
  const lines: string[] = [];
  lines.push("## Business Facts (Operator-Approved — answer ONLY from these facts)");
  lines.push("");
  lines.push(`**Business:** ${facts.businessName}`);
  lines.push(`**Timezone:** ${facts.timezone}`);
  lines.push("");

  lines.push("### Locations");
  for (const loc of facts.locations) {
    lines.push(`- ${loc.name}: ${loc.address}`);
    if (loc.parkingNotes) lines.push(`  Parking: ${loc.parkingNotes}`);
    if (loc.accessNotes) lines.push(`  Access: ${loc.accessNotes}`);
  }
  lines.push("");

  lines.push("### Opening Hours");
  for (const [day, hours] of Object.entries(facts.openingHours)) {
    if (hours.closed) {
      lines.push(`- ${day}: Closed`);
    } else {
      lines.push(`- ${day}: ${hours.open} - ${hours.close}`);
    }
  }
  lines.push("");

  lines.push("### Services");
  for (const svc of facts.services) {
    lines.push(`- ${svc.name}: ${svc.description}`);
    if (svc.durationMinutes) lines.push(`  Duration: ${svc.durationMinutes} min`);
    if (svc.price) lines.push(`  Price: ${svc.price} ${svc.currency ?? "SGD"}`);
  }
  lines.push("");

  if (facts.bookingPolicies) {
    lines.push("### Booking Policies");
    const bp = facts.bookingPolicies;
    if (bp.cancellationPolicy) lines.push(`- Cancellation: ${bp.cancellationPolicy}`);
    if (bp.reschedulePolicy) lines.push(`- Reschedule: ${bp.reschedulePolicy}`);
    if (bp.noShowPolicy) lines.push(`- No-show: ${bp.noShowPolicy}`);
    if (bp.advanceBookingDays) lines.push(`- Advance booking: ${bp.advanceBookingDays} days`);
    if (bp.prepInstructions) lines.push(`- Preparation: ${bp.prepInstructions}`);
    lines.push("");
  }

  lines.push("### Escalation Contact");
  lines.push(
    `${facts.escalationContact.name} via ${facts.escalationContact.channel}: ${facts.escalationContact.address}`,
  );
  lines.push("");

  if (facts.additionalFaqs.length > 0) {
    lines.push("### Additional FAQs");
    for (const faq of facts.additionalFaqs) {
      lines.push(`Q: ${faq.question}`);
      lines.push(`A: ${faq.answer}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
