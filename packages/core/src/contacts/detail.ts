import type { ContactStore } from "../lifecycle/contact-store.js";
import type { OpportunityStore } from "../lifecycle/opportunity-store.js";
import type { ConversationThreadStore } from "../conversations/thread-store.js";
import type { RecommendationStore } from "../recommendations/interfaces.js";
import type { HandoffStore, HandoffPackage } from "../handoff/types.js";
import type { RevenueStore } from "../lifecycle/revenue-store.js";
import type {
  ContactDetailResponse,
  ContactDetailProfile,
  ContactDetailOpportunity,
  ContactDetailThread,
  ContactDetailOpenDecision,
  ContactDetailRevenueEvent,
  Contact,
  Opportunity,
  ConversationThread,
  LifecycleRevenueEvent,
} from "@switchboard/schemas";
import type { Recommendation } from "../recommendations/types.js";

export class ContactNotFoundError extends Error {
  readonly code = "CONTACT_NOT_FOUND";
  constructor(message = "Contact not found") {
    super(message);
    this.name = "ContactNotFoundError";
  }
}

export interface ContactDetailDeps {
  contactStore: Pick<ContactStore, "findById">;
  opportunityStore: Pick<OpportunityStore, "findByContact">;
  threadStore: Pick<ConversationThreadStore, "getByContact">;
  recommendationStore: Pick<RecommendationStore, "listBySurface">;
  handoffStore: Pick<HandoffStore, "listPending">;
  revenueEventStore: Pick<RevenueStore, "findByContact">;
}

/**
 * Composite read-side projection for `/contacts/[id]`. Surface-agnostic — emits
 * the page-ready payload only; transport (Fastify route, Next route handler)
 * decides how to ship it. Cross-org access fails closed: `findById(orgId, id)`
 * returns null for both missing and other-org rows, and we throw the same
 * `ContactNotFoundError` for both — callers translate to 404.
 */
export async function getContactDetail(
  input: { orgId: string; contactId: string },
  deps: ContactDetailDeps,
): Promise<ContactDetailResponse> {
  const { orgId, contactId } = input;

  const contact = await deps.contactStore.findById(orgId, contactId);
  if (!contact) throw new ContactNotFoundError();

  const [opportunities, thread, recs, handoffs, revenueEvents] = await Promise.all([
    deps.opportunityStore.findByContact(orgId, contactId),
    deps.threadStore.getByContact(contactId, orgId),
    deps.recommendationStore.listBySurface({
      orgId,
      surface: "queue",
      status: "pending",
      limit: 50,
    }),
    deps.handoffStore.listPending(orgId),
    deps.revenueEventStore.findByContact(orgId, contactId),
  ]);

  return {
    profile: buildContactDetailProfile(contact),
    opportunities: buildContactDetailOpportunities(opportunities),
    threads: buildContactDetailThreads(thread),
    openDecisions: buildContactDetailOpenDecisions(recs, handoffs, contactId),
    revenueEvents: buildContactDetailRevenueEvents(revenueEvents),
  };
}

// Internally-modular builders. Public API stays composite (getContactDetail);
// these are exported only so D2/D4 follow-ons can split the projection without
// rewriting the page contract.

export function buildContactDetailProfile(c: Contact): ContactDetailProfile {
  const attributionSummary = summariseAttribution(c.attribution);
  return {
    id: c.id,
    displayName: c.name ?? c.phone ?? c.email ?? "—",
    primaryChannel: c.primaryChannel,
    stage: c.stage,
    phone: c.phone ?? null,
    email: c.email ?? null,
    source: c.source ?? null,
    sourceType: c.sourceType ?? null,
    attributionSummary,
    messagingConsent: {
      optedIn: c.messagingOptIn,
      optedInAt: c.messagingOptInAt ? c.messagingOptInAt.toISOString() : null,
      source: c.messagingOptInSource ?? null,
      optedOutAt: c.messagingOptOutAt ? c.messagingOptOutAt.toISOString() : null,
    },
    firstContactAt: c.firstContactAt.toISOString(),
    lastActivityAt: c.lastActivityAt.toISOString(),
  };
}

export function buildContactDetailOpportunities(opps: Opportunity[]): ContactDetailOpportunity[] {
  return opps.map((o) => ({
    id: o.id,
    serviceName: o.serviceName,
    stage: o.stage,
    estimatedValue: o.estimatedValue ?? null,
    openedAt: o.openedAt.toISOString(),
    closedAt: o.closedAt ? o.closedAt.toISOString() : null,
  }));
}

export function buildContactDetailThreads(
  thread: ConversationThread | null,
): ContactDetailThread[] {
  if (!thread) return [];
  return [
    {
      id: thread.id,
      assignedAgent: thread.assignedAgent,
      summary: thread.currentSummary,
      lastMessageAt: thread.lastOutcomeAt ? thread.lastOutcomeAt.toISOString() : null,
    },
  ];
}

export function buildContactDetailOpenDecisions(
  recs: Recommendation[],
  handoffs: HandoffPackage[],
  contactId: string,
): ContactDetailOpenDecision[] {
  const fromRecs: ContactDetailOpenDecision[] = recs
    .filter((r) => matchesContactIdInTargetEntities(r, contactId))
    .map((r) => ({
      id: r.id,
      kind: "approval" as const,
      agentKey: r.sourceAgent,
      title: r.humanSummary,
      createdAt: r.createdAt.toISOString(),
    }));

  const fromHandoffs: ContactDetailOpenDecision[] = handoffs
    .filter((h) => matchesContactIdInLeadSnapshot(h, contactId))
    .map((h) => ({
      id: h.id,
      kind: "handoff" as const,
      agentKey: null,
      title: "Handoff awaiting reply",
      createdAt: h.createdAt.toISOString(),
    }));

  return [...fromRecs, ...fromHandoffs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function buildContactDetailRevenueEvents(
  events: LifecycleRevenueEvent[],
): ContactDetailRevenueEvent[] {
  return events.map((e) => ({
    id: e.id,
    amount: e.amount,
    currency: e.currency,
    type: e.type,
    status: e.status,
    recordedAt: e.recordedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Schema-guarded fail-closed contactId matchers. Per spec §5.3: never coerce,
// never trim, never partial-match. Anything that isn't an exact string match
// is silently excluded.
// ---------------------------------------------------------------------------

function matchesContactIdInTargetEntities(r: Recommendation, contactId: string): boolean {
  const te = (r as unknown as { targetEntities?: unknown }).targetEntities;
  if (!te || typeof te !== "object") return false;
  const v = (te as Record<string, unknown>)["contactId"];
  return typeof v === "string" && v.length > 0 && v === contactId;
}

function matchesContactIdInLeadSnapshot(h: HandoffPackage, contactId: string): boolean {
  const ls = (h as unknown as { leadSnapshot?: unknown }).leadSnapshot;
  if (!ls || typeof ls !== "object") return false;
  const v = (ls as Record<string, unknown>)["leadId"];
  return typeof v === "string" && v.length > 0 && v === contactId;
}

function summariseAttribution(attribution: unknown): string | null {
  if (!attribution || typeof attribution !== "object") return null;
  const a = attribution as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof a["adSet"] === "string") parts.push(`ad set "${a["adSet"]}"`);
  if (typeof a["campaign"] === "string") parts.push(`campaign "${a["campaign"]}"`);
  if (typeof a["source"] === "string") parts.push(String(a["source"]));
  return parts.length > 0 ? parts.join(" · ") : null;
}
