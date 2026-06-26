/* eslint-disable max-lines -- this test-fixtures aggregator crossed the 600-line
   guideline when the D1 claim-first WorkTrace store fixtures (claim + finalize
   lifecycle on InMemory/ObservableWorkTraceStore) were added (PR #780). Suggested
   seam: extract the WorkTrace store fixtures into test-stores-work-trace.ts and
   re-export. Remove this disable when split. */
// Shared in-memory store stubs used by buildTestServer.
//
// Extracted from test-server.ts so the latter stays under the 600-line
// architecture-check threshold. Keep these stubs minimal — methods only
// implemented as the routes/tests they support require. New stubs added
// here should follow the same posture: real-enough behaviour for tests,
// but not feature-complete substitutes for the production stores.

import type {
  ContactStore,
  HandoffStore,
  Handoff,
  HandoffStatus,
  ConversationThreadStore,
  OpportunityStore,
  OpportunityBoardRow,
  TransitionStageInput,
  TransitionStageResult,
  RevenueStore,
  TriggerStore,
  TriggerBrowseQuery,
  TriggerBrowseResult,
} from "@switchboard/core";
import { OpportunityNotFoundError } from "@switchboard/core";
import type {
  ExecutionError,
  WorkTrace,
  WorkTraceStore,
  WorkTraceUpdateResult,
  WorkTraceReadResult,
  WorkTraceClaimResult,
  StrandedRunningClaim,
} from "@switchboard/core/platform";
import type {
  Contact,
  ConversationThread,
  Opportunity,
  LifecycleRevenueEvent,
  ScheduledTrigger,
  TriggerFilters,
  TriggerStatus,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// WorkTrace
// ---------------------------------------------------------------------------

export class InMemoryWorkTraceStore implements WorkTraceStore {
  private traces = new Map<string, WorkTrace>();

  async persist(trace: WorkTrace): Promise<void> {
    this.traces.set(trace.workUnitId, { ...trace });
  }

  async claim(trace: WorkTrace): Promise<WorkTraceClaimResult> {
    if (trace.idempotencyKey) {
      for (const existing of this.traces.values()) {
        if (
          existing.organizationId === trace.organizationId &&
          existing.idempotencyKey === trace.idempotencyKey
        ) {
          return { claimed: false };
        }
      }
    }
    this.traces.set(trace.workUnitId, { ...trace });
    return { claimed: true };
  }

  async getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadResult | null> {
    const trace = this.traces.get(workUnitId);
    if (!trace) return null;
    return { trace, integrity: { status: "ok" as const } };
  }

  async update(workUnitId: string, fields: Partial<WorkTrace>): Promise<WorkTraceUpdateResult> {
    const existing = this.traces.get(workUnitId);
    if (existing) {
      this.traces.set(workUnitId, { ...existing, ...fields });
    }
    return { ok: true, trace: this.traces.get(workUnitId) ?? ({} as never) };
  }

  async getByIdempotencyKey(
    organizationId: string,
    key: string,
  ): Promise<WorkTraceReadResult | null> {
    for (const trace of this.traces.values()) {
      if (trace.organizationId === organizationId && trace.idempotencyKey === key) {
        return { trace, integrity: { status: "ok" as const } };
      }
    }
    return null;
  }

  async findStuckRunning(olderThan: Date, limit: number): Promise<StrandedRunningClaim[]> {
    // Only KEYED `running` claims older than the threshold (keyless conversation /
    // lifecycle running rows are never reaped), oldest-first, bounded by limit.
    return [...this.traces.values()]
      .filter(
        (t) =>
          t.outcome === "running" &&
          t.idempotencyKey != null &&
          t.executionStartedAt != null &&
          new Date(t.executionStartedAt) < olderThan,
      )
      .sort((a, b) => (a.executionStartedAt! < b.executionStartedAt! ? -1 : 1))
      .slice(0, limit)
      .map((t) => ({
        workUnitId: t.workUnitId,
        organizationId: t.organizationId,
        idempotencyKey: t.idempotencyKey ?? null,
        intent: t.intent,
        traceId: t.traceId,
        executionStartedAt: t.executionStartedAt ?? null,
      }));
  }
}

/**
 * Test-only WorkTraceStore wrapper that records each ingress WorkTrace so route
 * tests can verify ingress-path flow. Subclasses InMemoryWorkTraceStore to
 * avoid runtime monkey-patching of the base store — the wrapper itself is the
 * observation point.
 *
 * Used by operator-direct ingress route tests (Wave 2 Phase 1b) to assert
 * `intent`, `mode`, `outcome`, `organizationId` on the most recent persisted
 * trace.
 *
 * D1 claim-first: a keyed operator-mutation submit now CREATES the WorkTrace via
 * claim() (outcome `running`) and FINALIZES it via update() (running ->
 * completed/failed). To keep "exactly one WorkTrace per route call" semantics,
 * we count a trace creation on persist() (no-key path) OR a successful claim()
 * — never on the finalize update — and refresh the recorded outcome when the
 * matching trace is finalized.
 */
export class ObservableWorkTraceStore extends InMemoryWorkTraceStore {
  public lastPersistedSummary: {
    intent: string;
    mode: string;
    outcome: string;
    organizationId: string;
    error?: Pick<ExecutionError, "code" | "message">;
  } | null = null;
  public persistCount = 0;
  private lastRecordedWorkUnitId: string | null = null;

  private record(trace: WorkTrace): void {
    this.lastPersistedSummary = {
      intent: trace.intent,
      mode: trace.mode,
      outcome: trace.outcome,
      organizationId: trace.organizationId,
      ...(trace.error ? { error: { code: trace.error.code, message: trace.error.message } } : {}),
    };
    this.lastRecordedWorkUnitId = trace.workUnitId;
  }

  async persist(trace: WorkTrace): Promise<void> {
    this.record(trace);
    this.persistCount += 1;
    await super.persist(trace);
  }

  async claim(trace: WorkTrace) {
    const result = await super.claim(trace);
    if (result.claimed) {
      this.record(trace);
      this.persistCount += 1;
    }
    return result;
  }

  async update(workUnitId: string, fields: Partial<WorkTrace>): Promise<WorkTraceUpdateResult> {
    const result = await super.update(workUnitId, fields);
    // Refresh the recorded summary's outcome/error when THIS trace is finalized
    // (running -> terminal). Scoped to the trace we recorded so unrelated
    // lifecycle/approval updates don't clobber the ingress observation.
    if (result.ok && workUnitId === this.lastRecordedWorkUnitId) {
      this.record(result.trace);
    }
    return result;
  }

  resetCounters(): void {
    this.lastPersistedSummary = null;
    this.persistCount = 0;
    this.lastRecordedWorkUnitId = null;
  }
}

// ---------------------------------------------------------------------------
// Decision-feed stubs (Contact, Handoff, ConversationThread).
// Tests that need to seed can do so via `app.contactStore.create(...)` etc.
// — only the methods used by routes/tests are implemented here.
// ---------------------------------------------------------------------------

export class TestContactStore implements ContactStore {
  private rows = new Map<string, Contact>();

  async create(input: import("@switchboard/core").CreateContactInput): Promise<Contact> {
    const id = `contact-${this.rows.size + 1}`;
    const now = new Date();
    const messagingOptIn = input.messagingOptIn ?? false;
    const contact: Contact = {
      id,
      organizationId: input.organizationId,
      name: input.name ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      primaryChannel: input.primaryChannel,
      firstTouchChannel: input.firstTouchChannel ?? null,
      stage: "new",
      source: input.source ?? null,
      attribution: (input.attribution as Contact["attribution"]) ?? null,
      roles: input.roles ?? ["lead"],
      messagingOptIn,
      messagingOptInAt: messagingOptIn ? now : null,
      messagingOptInSource: input.messagingOptInSource ?? null,
      messagingOptOutAt: null,
      duplicateContactRisk: false,
      firstContactAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, contact);
    return contact;
  }

  async recordMessagingOptOut(_orgId: string, id: string): Promise<void> {
    const c = this.rows.get(id);
    if (!c) throw new Error(`Contact not found: ${id}`);
    const now = new Date();
    this.rows.set(id, {
      ...c,
      messagingOptIn: false,
      messagingOptOutAt: now,
      updatedAt: now,
    });
  }

  async delete(_orgId: string, id: string): Promise<void> {
    if (!this.rows.has(id)) throw new Error(`Contact not found: ${id}`);
    this.rows.delete(id);
  }

  async findById(orgId: string, id: string): Promise<Contact | null> {
    const c = this.rows.get(id);
    // Org-scoped: cross-org reads must return null (mirrors PrismaContactStore
    // and the cross-org no-info-leak invariant exercised by api-contact-detail).
    if (!c || c.organizationId !== orgId) return null;
    return c;
  }

  async findByPhone(_orgId: string, phone: string): Promise<Contact | null> {
    for (const c of this.rows.values()) if (c.phone === phone) return c;
    return null;
  }

  async updateStage(
    _orgId: string,
    id: string,
    stage: import("@switchboard/schemas").ContactStage,
  ): Promise<Contact> {
    const c = this.rows.get(id);
    if (!c) throw new Error(`Contact not found: ${id}`);
    const updated = { ...c, stage, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async updateLastActivity(_orgId: string, id: string): Promise<void> {
    const c = this.rows.get(id);
    if (!c) return;
    this.rows.set(id, { ...c, lastActivityAt: new Date(), updatedAt: new Date() });
  }

  async list(orgId: string): Promise<Contact[]> {
    return Array.from(this.rows.values()).filter((c) => c.organizationId === orgId);
  }

  async listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>> {
    const out = new Map<string, Contact>();
    for (const id of ids) {
      const c = this.rows.get(id);
      if (c && c.organizationId === orgId) out.set(id, c);
    }
    return out;
  }

  async listForPipeline(args: {
    orgId: string;
    activitySince: Date;
    limit: number;
  }): Promise<{ rows: Contact[]; totalCount: number }> {
    const filtered = Array.from(this.rows.values())
      .filter(
        (c) =>
          c.organizationId === args.orgId &&
          (c.stage === "active" || c.stage === "new") &&
          c.lastActivityAt.getTime() >= args.activitySince.getTime(),
      )
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    return { rows: filtered.slice(0, args.limit), totalCount: filtered.length };
  }

  /**
   * KEEP IN SYNC WITH `PrismaContactStore.listForBrowse`.
   *
   * This in-memory shim is the only place keyset pagination semantics
   * execute against real rows in CI — `prisma-contact-store-browse.test.ts`
   * mocks Prisma at the call shape, not the row level. So if you change
   * the production keyset direction, the search OR-clause, or the order
   * tiebreak in `PrismaContactStore.listForBrowse`, **mirror the change
   * here in lockstep** and update both `prisma-contact-store-browse.test.ts`
   * (call-shape pin) and `api-contacts.test.ts` (route-level round-trip).
   * Otherwise the route tests keep passing while production silently breaks.
   */
  async listForBrowse(query: {
    orgId: string;
    stage?: import("@switchboard/schemas").ContactStage;
    search?: string;
    sort: "lastActivityAt" | "firstContactAt";
    direction: "asc" | "desc";
    cursor?: { ts: Date; id: string };
    limit: number;
  }): Promise<{
    rows: Contact[];
    opportunityCounts: Map<string, number>;
    hasMore: boolean;
    nextKeyset: { ts: Date; id: string } | null;
  }> {
    const all = Array.from(this.rows.values()).filter((c) => c.organizationId === query.orgId);
    const filtered = all.filter((c) => {
      if (query.stage && c.stage !== query.stage) return false;
      if (query.search) {
        const s = query.search.toLowerCase();
        const haystack = `${c.name ?? ""} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase();
        if (!haystack.includes(s)) return false;
      }
      return true;
    });

    const tsField = query.sort;
    const sorted = filtered.sort((a, b) => {
      const at = a[tsField].getTime();
      const bt = b[tsField].getTime();
      if (at !== bt) return query.direction === "desc" ? bt - at : at - bt;
      return query.direction === "desc" ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
    });

    const afterCursor = query.cursor
      ? sorted.filter((c) => {
          const ct = c[tsField].getTime();
          const xt = query.cursor!.ts.getTime();
          if (query.direction === "desc") {
            return ct < xt || (ct === xt && c.id < query.cursor!.id);
          }
          return ct > xt || (ct === xt && c.id > query.cursor!.id);
        })
      : sorted;

    const hasMore = afterCursor.length > query.limit;
    const trimmed = afterCursor.slice(0, query.limit);
    const last = trimmed.at(-1);
    const nextKeyset = hasMore && last ? { ts: last[tsField], id: last.id } : null;

    return {
      rows: trimmed,
      opportunityCounts: new Map(), // tests that care set their own counts
      hasMore,
      nextKeyset,
    };
  }
}

export class TestHandoffStore implements HandoffStore {
  private rows = new Map<string, Handoff>();

  async save(pkg: Handoff): Promise<void> {
    this.rows.set(pkg.id, pkg);
  }

  async getById(organizationId: string, id: string): Promise<Handoff | null> {
    const r = this.rows.get(id);
    return r && r.organizationId === organizationId ? r : null;
  }

  async getBySessionId(organizationId: string, sessionId: string): Promise<Handoff | null> {
    // Mirror the real store: newest matching row by createdAt, scoped to the org.
    return (
      [...this.rows.values()]
        .filter((r) => r.organizationId === organizationId && r.sessionId === sessionId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: HandoffStatus,
    acknowledgedAt?: Date,
  ): Promise<void> {
    const r = this.rows.get(id);
    if (!r || r.organizationId !== organizationId) {
      throw new Error(`Handoff not found or does not belong to organization: ${id}`);
    }
    this.rows.set(id, { ...r, status, ...(acknowledgedAt ? { acknowledgedAt } : {}) });
  }

  async listPending(organizationId: string): Promise<Handoff[]> {
    return Array.from(this.rows.values()).filter(
      (r) =>
        r.organizationId === organizationId &&
        (r.status === "pending" || r.status === "assigned" || r.status === "active"),
    );
  }
}

// ---------------------------------------------------------------------------
// Opportunity / Revenue stubs — added for /api/dashboard/contacts/:id (D1.5).
// Only the methods exercised by the contact-detail route are real; everything
// else throws so tests that need them must wire them explicitly. This mirrors
// the "real-enough behaviour for tests" posture documented at the top of the
// file.
// ---------------------------------------------------------------------------

export class TestOpportunityStore implements OpportunityStore {
  private rows = new Map<string, Opportunity>();
  private boardRows: OpportunityBoardRow[] = [];

  /** Test-only seed helper for legacy Opportunity rows. */
  seed(opp: Opportunity): void {
    this.rows.set(opp.id, opp);
  }

  /** Test-only seed helper for board rows (findOrgBoard / transitionStage). */
  seedBoard(rows: OpportunityBoardRow[]): void {
    this.boardRows = rows;
  }

  async findByContact(orgId: string, contactId: string): Promise<Opportunity[]> {
    return Array.from(this.rows.values()).filter(
      (o) => o.organizationId === orgId && o.contactId === contactId,
    );
  }

  async findOrgBoard(orgId: string): Promise<OpportunityBoardRow[]> {
    return this.boardRows
      .filter((r) => r.organizationId === orgId)
      .slice()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async transitionStage(input: TransitionStageInput): Promise<TransitionStageResult> {
    const idx = this.boardRows.findIndex(
      (r) => r.id === input.id && r.organizationId === input.orgId,
    );
    if (idx === -1) {
      throw new OpportunityNotFoundError(
        `Opportunity not found: ${input.id} (org: ${input.orgId})`,
      );
    }
    const existing = this.boardRows[idx]!;
    const now = new Date();
    const isTerminal = input.stage === "won" || input.stage === "lost";
    const updated: OpportunityBoardRow = {
      ...existing,
      stage: input.stage,
      closedAt: isTerminal ? (existing.closedAt ?? now) : null,
      updatedAt: now,
    };
    this.boardRows[idx] = updated;
    return { opportunity: updated };
  }

  async create(): Promise<Opportunity> {
    throw new Error("TestOpportunityStore.create not implemented");
  }
  async findById(): Promise<Opportunity | null> {
    throw new Error("TestOpportunityStore.findById not implemented");
  }
  async findActiveByContact(): Promise<Opportunity[]> {
    throw new Error("TestOpportunityStore.findActiveByContact not implemented");
  }
  async updateStage(): Promise<Opportunity> {
    throw new Error("TestOpportunityStore.updateStage not implemented");
  }
  async updateRevenueTotal(): Promise<void> {
    throw new Error("TestOpportunityStore.updateRevenueTotal not implemented");
  }
  async countByStage(): Promise<
    Array<{
      stage: import("@switchboard/schemas").OpportunityStage;
      count: number;
      totalValue: number;
    }>
  > {
    throw new Error("TestOpportunityStore.countByStage not implemented");
  }
}

export class TestRevenueStore implements RevenueStore {
  private rows = new Map<string, LifecycleRevenueEvent>();

  /** Test-only seed helper. */
  seed(evt: LifecycleRevenueEvent): void {
    this.rows.set(evt.id, evt);
  }

  async findByContact(orgId: string, contactId: string): Promise<LifecycleRevenueEvent[]> {
    return Array.from(this.rows.values()).filter(
      (e) => e.organizationId === orgId && e.contactId === contactId,
    );
  }

  async record(): Promise<LifecycleRevenueEvent> {
    throw new Error("TestRevenueStore.record not implemented");
  }
  async findByOpportunity(): Promise<LifecycleRevenueEvent[]> {
    throw new Error("TestRevenueStore.findByOpportunity not implemented");
  }
  async sumByOrg(): Promise<import("@switchboard/core").RevenueSummary> {
    throw new Error("TestRevenueStore.sumByOrg not implemented");
  }
  async sumByCampaign(): Promise<import("@switchboard/core").CampaignRevenueSummary[]> {
    throw new Error("TestRevenueStore.sumByCampaign not implemented");
  }
}

export class TestThreadStore implements ConversationThreadStore {
  private rows = new Map<string, ConversationThread>();
  private keyOf = (orgId: string, contactId: string) => `${orgId}::${contactId}`;

  async getByContact(
    contactId: string,
    organizationId: string,
  ): Promise<ConversationThread | null> {
    return this.rows.get(this.keyOf(organizationId, contactId)) ?? null;
  }

  async create(thread: ConversationThread): Promise<void> {
    this.rows.set(this.keyOf(thread.organizationId, thread.contactId), thread);
  }

  async update(): Promise<void> {
    // No-op for the routes that exercise this store today; tests that need it
    // can seed directly via create().
  }

  async listByContactIds(
    orgId: string,
    contactIds: string[],
  ): Promise<Map<string, ConversationThread>> {
    const out = new Map<string, ConversationThread>();
    for (const id of contactIds) {
      const t = this.rows.get(this.keyOf(orgId, id));
      if (t) out.set(id, t);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// ScheduledTrigger — backs GET /api/dashboard/automations (D2)
// ---------------------------------------------------------------------------

export class TestTriggerStore implements TriggerStore {
  private readonly triggers = new Map<string, ScheduledTrigger>();

  async save(trigger: ScheduledTrigger): Promise<void> {
    this.triggers.set(trigger.id, { ...trigger });
  }

  async findById(id: string): Promise<ScheduledTrigger | null> {
    return this.triggers.get(id) ?? null;
  }

  async findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
    let result = Array.from(this.triggers.values());
    if (filters.organizationId) {
      result = result.filter((t) => t.organizationId === filters.organizationId);
    }
    if (filters.status) result = result.filter((t) => t.status === filters.status);
    if (filters.type) result = result.filter((t) => t.type === filters.type);
    if (filters.sourceWorkflowId) {
      result = result.filter((t) => t.sourceWorkflowId === filters.sourceWorkflowId);
    }
    return result;
  }

  async updateStatus(id: string, status: TriggerStatus): Promise<void> {
    const t = this.triggers.get(id);
    if (t) this.triggers.set(id, { ...t, status });
  }

  async deleteExpired(_before: Date): Promise<number> {
    return 0;
  }

  async expireOverdue(_now: Date): Promise<number> {
    return 0;
  }

  async listForBrowse(query: TriggerBrowseQuery): Promise<TriggerBrowseResult> {
    const orgRows = Array.from(this.triggers.values()).filter(
      (t) => t.organizationId === query.orgId,
    );

    const statusCounts = {
      all: orgRows.length,
      active: orgRows.filter((t) => t.status === "active").length,
      fired: orgRows.filter((t) => t.status === "fired").length,
      cancelled: orgRows.filter((t) => t.status === "cancelled").length,
      expired: orgRows.filter((t) => t.status === "expired").length,
    };

    let filtered = orgRows;
    if (query.status) filtered = filtered.filter((t) => t.status === query.status);

    const dir = query.direction === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const tsCmp = a.createdAt.getTime() - b.createdAt.getTime();
      if (tsCmp !== 0) return tsCmp * dir;
      return a.id.localeCompare(b.id) * dir;
    });

    if (query.cursor) {
      const cTs = query.cursor.ts.getTime();
      const cId = query.cursor.id;
      filtered = filtered.filter((t) => {
        const tsCmp = t.createdAt.getTime() - cTs;
        if (tsCmp !== 0) return tsCmp * dir > 0;
        return t.id.localeCompare(cId) * dir > 0;
      });
    }

    const rows = filtered.slice(0, query.limit + 1);
    return { rows, statusCounts };
  }
}
