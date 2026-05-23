// ---------------------------------------------------------------------------
// Shared DTOs — stripped of internal Prisma fields
// ---------------------------------------------------------------------------

export interface DeploymentMemoryEntry {
  id: string;
  organizationId: string;
  deploymentId: string;
  category: string;
  content: string;
  confidence: number;
  sourceCount: number;
}

export interface InteractionSummaryEntry {
  id: string;
  summary: string;
  outcome: string;
  createdAt: Date;
}

export interface KnowledgeChunkEntry {
  id: string;
  content: string;
  sourceType: string;
  metadata: Record<string, unknown>;
}

export interface DraftFAQ {
  id: string;
  content: string;
  sourceType: string;
  draftStatus: string | null;
  draftExpiresAt: Date | null;
  createdAt: Date;
}

export interface ActivityLogEntry {
  id: string;
  organizationId: string;
  deploymentId: string;
  eventType: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Stripped fact for customer agent — no confidence/sourceCount metadata */
export interface CustomerFact {
  id: string;
  category: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Customer Scoped — read-only, no metadata, approved content only
// ---------------------------------------------------------------------------

export interface CustomerScopedMemoryAccess {
  getBusinessKnowledge(
    orgId: string,
    deploymentId: string,
    query: string,
  ): Promise<KnowledgeChunkEntry[]>;

  /** Returns facts stripped of confidence/sourceCount per anti-regurgitation policy */
  getHighConfidenceFacts(orgId: string, deploymentId: string): Promise<CustomerFact[]>;

  getContactSummaries(
    orgId: string,
    deploymentId: string,
    contactId: string,
  ): Promise<InteractionSummaryEntry[]>;
}

// ---------------------------------------------------------------------------
// Owner — full visibility and control
// ---------------------------------------------------------------------------

export interface OwnerMemoryAccess {
  listAllMemories(orgId: string, deploymentId: string): Promise<DeploymentMemoryEntry[]>;

  correctMemory(organizationId: string, id: string, content: string): Promise<void>;

  deleteMemory(organizationId: string, id: string): Promise<void>;

  listDraftFAQs(orgId: string, deploymentId: string): Promise<DraftFAQ[]>;

  approveDraftFAQ(organizationId: string, faqId: string): Promise<void>;

  rejectDraftFAQ(organizationId: string, faqId: string): Promise<void>;

  listActivityLog(
    orgId: string,
    deploymentId: string,
    opts?: { limit?: number },
  ): Promise<ActivityLogEntry[]>;

  listAllSummaries(
    orgId: string,
    deploymentId: string,
    opts?: { limit?: number },
  ): Promise<InteractionSummaryEntry[]>;
}

// ---------------------------------------------------------------------------
// Aggregate — write + aggregate patterns, no individual contact data
// ---------------------------------------------------------------------------

export interface AggregateScopedMemoryAccess {
  upsertFact(entry: Omit<DeploymentMemoryEntry, "id">): Promise<DeploymentMemoryEntry>;

  writeSummary(
    entry: Omit<InteractionSummaryEntry, "id"> & {
      organizationId: string;
      deploymentId: string;
      channelType: string;
      contactId?: string;
      extractedFacts: unknown[];
      questionsAsked: string[];
      duration: number;
      messageCount: number;
    },
  ): Promise<void>;

  writeActivityLog(entry: Omit<ActivityLogEntry, "id" | "createdAt">): Promise<void>;

  findFactsByCategory(
    orgId: string,
    deploymentId: string,
    category: string,
  ): Promise<DeploymentMemoryEntry[]>;

  promoteDraftFAQs(olderThan: Date): Promise<number>;

  decayStale(input: {
    cutoffDate: Date;
    decayAmount: number;
    floor: number;
    startOfDay: Date;
  }): Promise<number>;
}
