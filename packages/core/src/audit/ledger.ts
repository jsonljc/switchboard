import { randomUUID } from "node:crypto";
import type {
  AuditEntry,
  AuditEventType,
  RiskCategory,
  VisibilityLevel,
  ActorType,
} from "@switchboard/schemas";
import { computeAuditHashSync, verifyChain as verifyChainIntegrity, ensureCanonicalize } from "./canonical-hash.js";
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
  }): Promise<AuditEntry> {
    // Ensure canonicalize is loaded before computing hashes
    await ensureCanonicalize();

    const latest = await this.storage.getLatest();
    const previousEntryHash = latest?.entryHash ?? null;

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

    const entryHash = computeAuditHashSync(hashInput);

    const entry: AuditEntry = {
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
    };

    await this.storage.append(entry);
    return entry;
  }

  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    return this.storage.query(filter);
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
    await ensureCanonicalize();
    return verifyChainIntegrity(hashEntries);
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
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  getAll(): AuditEntry[] {
    return [...this.entries];
  }
}
