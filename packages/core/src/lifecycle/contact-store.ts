import type { Contact, ContactStage, MessagingOptInSource } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Browse query (powers the read-only /contacts list view via core's
// `listContactsForBrowse` projection — distinct from `list(...)` which is
// used by skill-runtime tools and lifecycle services and must not change).
// ---------------------------------------------------------------------------

export interface ContactBrowseQuery {
  orgId: string;
  stage?: ContactStage;
  search?: string;
  sort: "lastActivityAt" | "firstContactAt";
  direction: "asc" | "desc";
  /**
   * Pre-decoded keyset cursor. The store is unaware of base64; the projector
   * encodes/decodes on the way in/out.
   */
  cursor?: { ts: Date; id: string };
  limit: number;
}

export interface ContactBrowseResult {
  rows: Contact[];
  /** contactId → non-terminal opportunity count, capped at 99. */
  opportunityCounts: Map<string, number>;
  hasMore: boolean;
  /** The (sortField, id) of the last returned row when `hasMore`. */
  nextKeyset: { ts: Date; id: string } | null;
}

export interface CreateContactInput {
  organizationId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  primaryChannel: "whatsapp" | "telegram" | "dashboard";
  firstTouchChannel?: string | null;
  source?: string | null;
  attribution?: Record<string, unknown> | null;
  roles?: string[];
  messagingOptIn?: boolean;
  messagingOptInSource?: MessagingOptInSource;
}

export interface ContactFilters {
  stage?: ContactStage;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface ContactStore {
  create(input: CreateContactInput): Promise<Contact>;
  findById(orgId: string, id: string): Promise<Contact | null>;
  findByPhone(orgId: string, phone: string): Promise<Contact | null>;
  updateStage(orgId: string, id: string, stage: ContactStage): Promise<Contact>;
  updateLastActivity(orgId: string, id: string): Promise<void>;
  /** Record a WhatsApp messaging opt-out (e.g., user replied "STOP"). */
  recordMessagingOptOut(orgId: string, id: string): Promise<void>;
  /**
   * Hard-delete a Contact and all PII-bearing child records in a single
   * transaction. Used by the Meta Data Deletion callback to comply with
   * App Review requirements.
   */
  delete(orgId: string, id: string): Promise<void>;
  list(orgId: string, filters?: ContactFilters): Promise<Contact[]>;
  listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>>;
  /**
   * Lists contacts for the agent-home pipeline block: active + new stages,
   * with a `lastActivityAt >= activitySince` recency cutoff. Returns
   * push-down totalCount alongside the limited rows so the UI's count badge
   * stays truthful when more matches exist than fit in the tile cap.
   */
  listForPipeline(args: {
    orgId: string;
    activitySince: Date;
    limit: number;
  }): Promise<{ rows: Contact[]; totalCount: number }>;
  /**
   * Read-only browse for the Mercury `/contacts` list surface. Distinct from
   * `list(orgId, filters)` to keep the existing skill-runtime / lifecycle
   * callers' contract stable. Cursor is `(sortField, id)` keyset; the
   * `lastActivityAt` invariant (non-nullable in the current schema) is what
   * makes the cursor totally ordered — see plan §"Implementer watch-outs".
   */
  listForBrowse(query: ContactBrowseQuery): Promise<ContactBrowseResult>;
}
