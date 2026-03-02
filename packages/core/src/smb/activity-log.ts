import { randomUUID } from "node:crypto";
import { redactSnapshot, DEFAULT_REDACTION_CONFIG } from "../audit/redaction.js";
import type { RedactionConfig } from "../audit/redaction.js";

export type ActivityResult =
  | "allowed"
  | "denied"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  actorId: string;
  actorType: "user" | "agent" | "system";
  actionType: string;
  result: ActivityResult;
  amount: number | null;
  summary: string;
  snapshot: Record<string, unknown>;
  envelopeId: string | null;
  organizationId: string;
  redactionApplied: boolean;
  redactedFields: string[];
}

export interface ActivityLogQuery {
  organizationId: string;
  actorId?: string;
  actionType?: string;
  result?: ActivityResult;
  envelopeId?: string;
  after?: Date;
  before?: Date;
  limit?: number;
  offset?: number;
}

export interface ActivityLogStorage {
  append(entry: ActivityLogEntry): Promise<void>;
  query(filter: ActivityLogQuery): Promise<ActivityLogEntry[]>;
}

export class InMemorySmbActivityLogStorage implements ActivityLogStorage {
  private entries: ActivityLogEntry[] = [];

  async append(entry: ActivityLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async query(filter: ActivityLogQuery): Promise<ActivityLogEntry[]> {
    let results = this.entries.filter(
      (e) => e.organizationId === filter.organizationId,
    );

    if (filter.actorId) {
      results = results.filter((e) => e.actorId === filter.actorId);
    }
    if (filter.actionType) {
      results = results.filter((e) => e.actionType === filter.actionType);
    }
    if (filter.result) {
      results = results.filter((e) => e.result === filter.result);
    }
    if (filter.envelopeId) {
      results = results.filter((e) => e.envelopeId === filter.envelopeId);
    }
    if (filter.after) {
      results = results.filter((e) => e.timestamp >= filter.after!);
    }
    if (filter.before) {
      results = results.filter((e) => e.timestamp < filter.before!);
    }

    // Sort newest first
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  /** For testing: get all entries */
  getAll(): ActivityLogEntry[] {
    return [...this.entries];
  }
}

export class SmbActivityLog {
  private storage: ActivityLogStorage;
  private redactionConfig: RedactionConfig;

  constructor(
    storage: ActivityLogStorage,
    redactionConfig: RedactionConfig = DEFAULT_REDACTION_CONFIG,
  ) {
    this.storage = storage;
    this.redactionConfig = redactionConfig;
  }

  async record(params: {
    actorId: string;
    actorType: "user" | "agent" | "system";
    actionType: string;
    result: ActivityResult;
    amount: number | null;
    summary: string;
    snapshot: Record<string, unknown>;
    envelopeId: string | null;
    organizationId: string;
  }): Promise<ActivityLogEntry> {
    const { redacted, redactedFields, redactionApplied } = redactSnapshot(
      params.snapshot,
      this.redactionConfig,
    );

    const entry: ActivityLogEntry = {
      id: `act_${randomUUID()}`,
      timestamp: new Date(),
      actorId: params.actorId,
      actorType: params.actorType,
      actionType: params.actionType,
      result: params.result,
      amount: params.amount,
      summary: params.summary,
      snapshot: redacted,
      envelopeId: params.envelopeId,
      organizationId: params.organizationId,
      redactionApplied,
      redactedFields,
    };

    await this.storage.append(entry);
    return entry;
  }

  async query(filter: ActivityLogQuery): Promise<ActivityLogEntry[]> {
    return this.storage.query(filter);
  }
}
