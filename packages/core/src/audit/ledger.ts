import { randomUUID } from "node:crypto";
import type {
  AuditEntry,
  AuditEventType,
  RiskCategory,
  VisibilityLevel,
  ActorType,
} from "@switchboard/schemas";
import { computeAuditHash, computeAuditHashSync, verifyChain as verifyChainIntegrity } from "./canonical-hash.js";
import type { AuditHashInput } from "./canonical-hash.js";
import { redactSnapshot, DEFAULT_REDACTION_CONFIG } from "./redaction.js";
import type { RedactionConfig } from "./redaction.js";
import { storeEvidence } from "./evidence.js";
import type { EvidencePointer } from "./evidence.js";

export interface LedgerStorage {
  append(entry: AuditEntry): Promise<void>;
  getLatest(): Promise<AuditEntry | null>;
  getById(id: string): Promise<AuditEntry | null>;
  query(filter: AuditQueryFilter): Promise<AuditEntry[]>;
  /**
   * Optional: atomically get latest + append within a serialized lock.
   * Prevents race conditions on previousEntryHash in multi-instance deployments.
   * If not implemented, AuditLedger falls back to non-atomic getLatest() + append().
   */
  appendAtomic?(buildEntry: (previousEntryHash: string | null) => Promise<AuditEntry>): Promise<AuditEntry>;
}

export interface AuditQueryFilter {
  eventType?: AuditEventType;
  entityType?: string;
  entityId?: string;
  envelopeId?: string;
  organizationId?: string;
  after?: Date;
  before?: Date;
  limit?: number;
  offset?: number;
}

function generateId(): string {
  return `audit_${randomUUID()}`;
}

export class AuditLedger {
  private storage: LedgerStorage;
  private redactionConfig: RedactionConfig | undefined;

  constructor(storage: LedgerStorage, redactionConfig: RedactionConfig | undefined = DEFAULT_REDACTION_CONFIG) {
    this.storage = storage;
    this.redactionConfig = redactionConfig;
  }

  async record(params: {
    eventType: AuditEventType;
    actorType: ActorType;
    actorId: string;
    entityType: string;
    entityId: string;
    riskCategory: RiskCategory;
    summary: string;
    snapshot: Record<string, unknown>;
    evidence?: unknown[];
    envelopeId?: string;
    organizationId?: string;
    visibilityLevel?: VisibilityLevel;
    /** Optional correlation id; not part of chain hash. */
    traceId?: string | null;
  }): Promise<AuditEntry> {
    // Use atomic append if available (prevents race on previousEntryHash)
    if (this.storage.appendAtomic) {
      return this.storage.appendAtomic((previousEntryHash) =>
        this.buildEntry(params, previousEntryHash),
      );
    }

    // Fallback: non-atomic path (safe for single-instance)
    const latest = await this.storage.getLatest();
    const previousEntryHash = latest?.entryHash ?? null;
    const entry = await this.buildEntry(params, previousEntryHash);
    await this.storage.append(entry);
    return entry;
  }

  private async buildEntry(params: {
    eventType: AuditEventType;
    actorType: ActorType;
    actorId: string;
    entityType: string;
    entityId: string;
    riskCategory: RiskCategory;
    summary: string;
    snapshot: Record<string, unknown>;
    evidence?: unknown[];
    envelopeId?: string;
    organizationId?: string;
    visibilityLevel?: VisibilityLevel;
    traceId?: string | null;
  }, previousEntryHash: string | null): Promise<AuditEntry> {
    // Redact snapshot
    const redactionResult = this.redactionConfig
      ? redactSnapshot(params.snapshot, this.redactionConfig)
      : { redacted: params.snapshot, redactedFields: [] as string[], redactionApplied: false };

    // Process evidence
    const evidencePointers: EvidencePointer[] = (params.evidence ?? []).map((e) =>
      storeEvidence(e),
    );

    const id = generateId();
    const timestamp = new Date();

    // Compute hash
    const hashInput: AuditHashInput = {
      chainHashVersion: 1,
      schemaVersion: 1,
      id,
      eventType: params.eventType,
      timestamp: timestamp.toISOString(),
      actorType: params.actorType,
      actorId: params.actorId,
      entityType: params.entityType,
      entityId: params.entityId,
      riskCategory: params.riskCategory,
      snapshot: redactionResult.redacted,
      evidencePointers: evidencePointers.map((ep) => ({
        type: ep.type,
        hash: ep.hash,
        storageRef: ep.storageRef,
      })),
      summary: params.summary,
      previousEntryHash,
    };

    const entryHash = computeAuditHash(hashInput);

    return {
      id,
      eventType: params.eventType,
      timestamp,
      actorType: params.actorType,
      actorId: params.actorId,
      entityType: params.entityType,
      entityId: params.entityId,
      riskCategory: params.riskCategory,
      visibilityLevel: params.visibilityLevel ?? "public",
      summary: params.summary,
      snapshot: redactionResult.redacted,
      evidencePointers,
      redactionApplied: redactionResult.redactionApplied,
      redactedFields: redactionResult.redactedFields,
      chainHashVersion: 1,
      schemaVersion: 1,
      entryHash,
      previousEntryHash,
      envelopeId: params.envelopeId ?? null,
      organizationId: params.organizationId ?? null,
      traceId: params.traceId ?? null,
    };
  }

  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    return this.storage.query(filter);
  }

  async getById(id: string): Promise<AuditEntry | null> {
    return this.storage.getById(id);
  }

  async verifyChain(entries: AuditEntry[]): Promise<{
    valid: boolean;
    brokenAt: number | null;
  }> {
    // Convert AuditEntry[] to the format expected by verifyChainIntegrity
    const hashEntries = entries.map((entry) => ({
      chainHashVersion: entry.chainHashVersion,
      schemaVersion: entry.schemaVersion,
      id: entry.id,
      eventType: entry.eventType,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
      actorType: entry.actorType,
      actorId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      riskCategory: entry.riskCategory,
      snapshot: entry.snapshot,
      evidencePointers: entry.evidencePointers.map((ep) => ({
        type: ep.type,
        hash: ep.hash,
        storageRef: ep.storageRef,
      })),
      summary: entry.summary,
      previousEntryHash: entry.previousEntryHash,
      entryHash: entry.entryHash,
    }));
    return verifyChainIntegrity(hashEntries);
  }

  async deepVerify(entries: AuditEntry[]): Promise<{
    valid: boolean;
    entriesChecked: number;
    chainValid: boolean;
    chainBrokenAt: number | null;
    hashMismatches: Array<{ index: number; entryId: string; expected: string; actual: string }>;
  }> {
    const sorted = [...entries].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    const hashMismatches: Array<{ index: number; entryId: string; expected: string; actual: string }> = [];
    let chainBrokenAt: number | null = null;

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]!;

      // Recompute hash from entry fields
      const hashInput: AuditHashInput = {
        chainHashVersion: entry.chainHashVersion,
        schemaVersion: entry.schemaVersion,
        id: entry.id,
        eventType: entry.eventType,
        timestamp: entry.timestamp.toISOString(),
        actorType: entry.actorType,
        actorId: entry.actorId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        riskCategory: entry.riskCategory,
        snapshot: entry.snapshot,
        evidencePointers: entry.evidencePointers.map((ep) => ({
          type: ep.type,
          hash: ep.hash,
          storageRef: ep.storageRef,
        })),
        summary: entry.summary,
        previousEntryHash: entry.previousEntryHash,
      };

      const recomputed = computeAuditHashSync(hashInput);
      if (recomputed !== entry.entryHash) {
        hashMismatches.push({
          index: i,
          entryId: entry.id,
          expected: entry.entryHash,
          actual: recomputed,
        });
      }

      // Chain link check
      if (i > 0 && chainBrokenAt === null) {
        const previous = sorted[i - 1]!;
        if (entry.previousEntryHash !== previous.entryHash) {
          chainBrokenAt = i;
        }
      }
    }

    return {
      valid: hashMismatches.length === 0 && chainBrokenAt === null,
      entriesChecked: sorted.length,
      chainValid: chainBrokenAt === null,
      chainBrokenAt,
      hashMismatches,
    };
  }
}

// In-memory storage for testing
export class InMemoryLedgerStorage implements LedgerStorage {
  private entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async getLatest(): Promise<AuditEntry | null> {
    return this.entries[this.entries.length - 1] ?? null;
  }

  async getById(id: string): Promise<AuditEntry | null> {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    let result = [...this.entries];

    if (filter.eventType) {
      result = result.filter((e) => e.eventType === filter.eventType);
    }
    if (filter.entityType) {
      result = result.filter((e) => e.entityType === filter.entityType);
    }
    if (filter.entityId) {
      result = result.filter((e) => e.entityId === filter.entityId);
    }
    if (filter.envelopeId) {
      result = result.filter((e) => e.envelopeId === filter.envelopeId);
    }
    if (filter.organizationId) {
      result = result.filter((e) => e.organizationId === filter.organizationId);
    }
    if (filter.after) {
      result = result.filter((e) => e.timestamp > filter.after!);
    }
    if (filter.before) {
      result = result.filter((e) => e.timestamp < filter.before!);
    }
    if (filter.limit) {
      const offset = filter.offset ?? 0;
      result = result.slice(offset, offset + filter.limit);
    } else if (filter.offset) {
      result = result.slice(filter.offset);
    }

    return result;
  }

  getAll(): AuditEntry[] {
    return [...this.entries];
  }
}
