import type {
  ScheduledTrigger,
  TriggerFilters,
  TriggerStatus,
  TriggerStatusCounts,
} from "@switchboard/schemas";

/**
 * Pre-decoded keyset cursor handed to `listForBrowse`. The store is unaware
 * of base64; the projector (core/list-triggers.ts) encodes/decodes on the
 * way in/out. Mirrors the ContactBrowseQuery cursor pattern.
 */
export interface TriggerBrowseCursor {
  ts: Date;
  id: string;
}

export interface TriggerBrowseQuery {
  orgId: string;
  status?: TriggerStatus;
  sort: "createdAt";
  direction: "asc" | "desc";
  cursor?: TriggerBrowseCursor;
  /** Store fetches up to `limit + 1` rows so the projector can detect hasMore. */
  limit: number;
}

export interface TriggerBrowseResult {
  /** Up to `limit + 1` rows. Core trims to `limit` and computes hasMore. */
  rows: ScheduledTrigger[];
  /** Per-status counts across all org rows (single GROUP BY). */
  statusCounts: TriggerStatusCounts;
}

export interface TriggerStore {
  save(trigger: ScheduledTrigger): Promise<void>;
  findById(id: string): Promise<ScheduledTrigger | null>;
  findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]>;
  updateStatus(id: string, status: TriggerStatus): Promise<void>;
  deleteExpired(before: Date): Promise<number>;
  /** Mark active triggers whose expiresAt has passed as "expired". */
  expireOverdue(now: Date): Promise<number>;
  /**
   * Read-only browse projection backing `GET /api/dashboard/automations`.
   * Distinct from `findByFilters` — this method handles cursor pagination,
   * sort direction, and per-status counts in one round-trip. Mutating callers
   * and event matching keep using the existing methods.
   */
  listForBrowse(query: TriggerBrowseQuery): Promise<TriggerBrowseResult>;
}
