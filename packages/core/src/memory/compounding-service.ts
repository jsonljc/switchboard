import type { ConversationEndEvent } from "../channel-gateway/conversation-lifecycle.js";
import type { EmbeddingAdapter } from "../embedding-adapter.js";
import {
  CANONICAL_KEY_PATTERN,
  MAX_DEPLOYMENT_MEMORY_ENTRIES,
  MEDSPA_CANONICAL_KEYS,
  OUTCOME_PATTERN_MERGE_THRESHOLD,
  computeConfidenceScore,
  isKnownCanonicalKey,
} from "@switchboard/schemas";
import type { DeploymentMemorySource } from "@switchboard/schemas";
import { StaleVersionError } from "../approval/state-machine.js";
import { buildSummarizationPrompt, buildFactExtractionPrompt } from "./extraction-prompts.js";
import { shouldExtractOutcomePatterns } from "./outcome-pattern-extractor.js";
import { resolveBookingAttribution, type BookingAttributionStore } from "./booking-attribution.js";
import { getMetrics } from "../telemetry/metrics.js";

export interface CompoundingLLMClient {
  complete(prompt: string): Promise<string>;
}

export interface CompoundingInteractionSummaryStore {
  create(input: {
    organizationId: string;
    deploymentId: string;
    channelType: string;
    contactId?: string;
    summary: string;
    outcome: string;
    extractedFacts: unknown[];
    questionsAsked: string[];
    duration: number;
    messageCount: number;
  }): Promise<{ id: string }>;
}

export interface CompoundingDeploymentMemoryStore {
  findByCategory(
    organizationId: string,
    deploymentId: string,
    category: string,
  ): Promise<
    Array<{
      id: string;
      content: string;
      sourceCount: number;
      confidence: number;
      canonicalKey?: string | null;
    }>
  >;
  findByCategoryAndCanonicalKey(
    organizationId: string,
    deploymentId: string,
    category: string,
    canonicalKey: string,
  ): Promise<Array<{ id: string; content: string; sourceCount: number; confidence: number }>>;
  create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
    source?: DeploymentMemorySource | null;
  }): Promise<{ id: string }>;
  incrementConfidence(
    organizationId: string,
    id: string,
    newConfidence: number,
  ): Promise<{ id: string; sourceCount: number }>;
  countByDeployment(organizationId: string, deploymentId: string): Promise<number>;
  /**
   * Lowest-value eviction candidate for a deployment: lowest confidence,
   * tie-broken by oldest lastSeenAt (LRU). Returns null when the deployment
   * has no entries. Used to admit a higher-value fact once the cap is hit.
   */
  findEvictionCandidate(
    organizationId: string,
    deploymentId: string,
  ): Promise<{ id: string; confidence: number } | null>;
  delete(organizationId: string, id: string): Promise<void>;
  /**
   * Soft-remove (invalidate) a memory: set invalidatedAt + validTo, never
   * physically delete, so an evicted/decayed row frees a cap slot while its
   * history + provenance survive. Throws StaleVersionError when already gone
   * (drop-in for the eviction path's existing delete() error handling).
   */
  invalidate(organizationId: string, id: string): Promise<void>;
}

export interface DeploymentMemoryEvidenceStore {
  recordEvidence(input: {
    deploymentMemoryId: string;
    organizationId: string;
    bookingId: string | null;
    conversionRecordId: string | null;
    workTraceId: string | null;
    attributionTier: "strong" | "fallback";
  }): Promise<void>;
}

export interface CompoundingDeps {
  llmClient: CompoundingLLMClient;
  embeddingAdapter: EmbeddingAdapter;
  interactionSummaryStore: CompoundingInteractionSummaryStore;
  deploymentMemoryStore: CompoundingDeploymentMemoryStore;
  knowledgeStore?: {
    store(chunk: {
      id: string;
      organizationId: string;
      agentId: string;
      deploymentId?: string;
      documentId: string;
      content: string;
      sourceType: string;
      embedding: number[];
      chunkIndex: number;
      metadata: Record<string, unknown>;
      draftStatus?: string | null;
      draftExpiresAt?: Date | null;
    }): Promise<void>;
  };
  bookingStore?: BookingAttributionStore;
  evidenceStore?: DeploymentMemoryEvidenceStore;
  agentId?: string;
}

const MIN_MESSAGES = 2;
const SIMILARITY_THRESHOLD = 0.92;
// Confidence a brand-new fact (sourceCount 1) is stored at, derived from the
// canonical formula rather than hardcoded so it can't drift from the value the
// store actually persists. This is also the rank a newcomer must beat to evict
// an existing entry once the cap is hit.
const NEW_FACT_CONFIDENCE = computeConfidenceScore(1, false);
const FAQ_PROMOTION_THRESHOLD = 3;
const FAQ_DRAFT_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours
const MAX_PATTERNS_PER_CONVERSATION = 5;
const MAX_PATTERN_LENGTH = 500;

interface ExtractedPattern {
  text: string;
  canonicalKey: string;
}

function sanitizeExtractedPatterns(raw: unknown): ExtractedPattern[] {
  if (!Array.isArray(raw)) return [];
  const candidates: ExtractedPattern[] = [];
  for (const p of raw) {
    if (p === null || typeof p !== "object") continue;
    const candidate = p as { text?: unknown; canonicalKey?: unknown };
    if (typeof candidate.text !== "string" || typeof candidate.canonicalKey !== "string") continue;
    if (candidate.text.trim().length === 0) continue;
    const text =
      candidate.text.length > MAX_PATTERN_LENGTH
        ? candidate.text.slice(0, MAX_PATTERN_LENGTH)
        : candidate.text;
    candidates.push({ text, canonicalKey: candidate.canonicalKey });
    if (candidates.length >= MAX_PATTERNS_PER_CONVERSATION) break;
  }
  return candidates;
}

interface SummarizationResult {
  summary: string;
  outcome: string;
}

interface ExtractionResult {
  facts: Array<{ fact: string; confidence: number; category: string }>;
  questions: string[];
  patterns: ExtractedPattern[]; // populated only when outcome is "booked"
}

/**
 * Per-deployment enum lookup. v1 ships medspa-only; vertical config arrives
 * in a later workstream. Centralizing here means the call site does not
 * branch on deployment shape, only on the resolved enumeration.
 */
function resolveCanonicalEnum(_deploymentId: string): readonly string[] {
  return MEDSPA_CANONICAL_KEYS;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export class ConversationCompoundingService {
  private readonly llm: CompoundingLLMClient;
  private readonly embedding: EmbeddingAdapter;
  private readonly summaryStore: CompoundingInteractionSummaryStore;
  private readonly memoryStore: CompoundingDeploymentMemoryStore;
  private readonly knowledgeStore: CompoundingDeps["knowledgeStore"];
  private readonly bookingStore: BookingAttributionStore | undefined;
  private readonly evidenceStore: DeploymentMemoryEvidenceStore | undefined;
  private readonly agentId: string;

  constructor(deps: CompoundingDeps) {
    this.llm = deps.llmClient;
    this.embedding = deps.embeddingAdapter;
    this.summaryStore = deps.interactionSummaryStore;
    this.memoryStore = deps.deploymentMemoryStore;
    this.knowledgeStore = deps.knowledgeStore;
    this.bookingStore = deps.bookingStore;
    this.evidenceStore = deps.evidenceStore;
    this.agentId = deps.agentId ?? "default";
  }

  async processConversationEnd(event: ConversationEndEvent): Promise<void> {
    if (event.messages.length < MIN_MESSAGES) return;

    try {
      const [summarization, extraction] = await Promise.all([
        this.summarize(event.messages),
        this.extractFacts(event.messages, event.deploymentId),
      ]);

      await this.summaryStore.create({
        organizationId: event.organizationId,
        deploymentId: event.deploymentId,
        channelType: event.channelType,
        contactId: event.contactId ?? undefined,
        summary: summarization.summary,
        outcome: summarization.outcome,
        extractedFacts: extraction.facts,
        questionsAsked: extraction.questions,
        duration: event.duration,
        messageCount: event.messageCount,
      });

      for (const fact of extraction.facts) {
        await this.upsertFact(event.organizationId, event.deploymentId, fact);
      }

      for (const question of extraction.questions) {
        await this.trackQuestion(event.organizationId, event.deploymentId, question);
      }

      // Booking-backed gating supersedes summarization.outcome as the source
      // of truth for whether a conversation booked. summarization.outcome is
      // still required to be a booking-shaped outcome — patterns are only
      // meaningful when the LLM extraction produced booking-relevant phrasing
      // — but the AUTHORITY for "this conversation booked" is the Booking
      // row, not the LLM.
      if (
        shouldExtractOutcomePatterns(summarization.outcome) &&
        extraction.patterns?.length &&
        this.bookingStore
      ) {
        await this.processOutcomePatterns(event, extraction.patterns, this.bookingStore);
      }
    } catch (err) {
      console.error("[CompoundingService] Failed to process conversation end:", err);
    }
  }

  private async processOutcomePatterns(
    event: ConversationEndEvent,
    rawPatterns: ExtractedPattern[],
    bookingStore: BookingAttributionStore,
  ): Promise<void> {
    const attribution = await resolveBookingAttribution(bookingStore, event);
    if (attribution.tier === "none") return;

    const metrics = getMetrics();
    const sanitized = sanitizeExtractedPatterns(rawPatterns);
    const enumeration = resolveCanonicalEnum(event.deploymentId);

    for (const pattern of sanitized) {
      // Structural validation first — a malformed slug indicates a prompt
      // bug, counted separately from "unknown but well-shaped" slugs.
      if (!CANONICAL_KEY_PATTERN.test(pattern.canonicalKey)) {
        metrics.outcomePatternsRejected.inc({
          deploymentId: event.deploymentId,
          reason: "invalid_canonical_key",
        });
        continue;
      }
      if (!isKnownCanonicalKey(pattern.canonicalKey, enumeration)) {
        metrics.outcomePatternsRejected.inc({
          deploymentId: event.deploymentId,
          reason: "unknown_canonical_key",
        });
        continue;
      }
      try {
        metrics.outcomePatternsExtracted.inc({
          deploymentId: event.deploymentId,
          attributionTier: attribution.tier,
        });
        const memoryId = await this.trackPattern(
          event.organizationId,
          event.deploymentId,
          pattern.text,
          pattern.canonicalKey,
        );
        if (this.evidenceStore && attribution.bookingId) {
          await this.evidenceStore.recordEvidence({
            deploymentMemoryId: memoryId,
            organizationId: event.organizationId,
            bookingId: attribution.bookingId,
            conversionRecordId: null,
            workTraceId: attribution.workTraceId ?? null,
            attributionTier: attribution.tier,
          });
        }
      } catch (err) {
        console.error("[CompoundingService] trackPattern failed", err);
      }
    }
  }

  private async summarize(
    messages: Array<{ role: string; content: string }>,
  ): Promise<SummarizationResult> {
    const prompt = buildSummarizationPrompt(messages);
    const raw = await this.llm.complete(prompt);
    return JSON.parse(raw) as SummarizationResult;
  }

  private async extractFacts(
    messages: Array<{ role: string; content: string }>,
    deploymentId: string,
  ): Promise<ExtractionResult> {
    const enumeration = resolveCanonicalEnum(deploymentId);
    const prompt = buildFactExtractionPrompt(messages, enumeration);
    const raw = await this.llm.complete(prompt);
    return JSON.parse(raw) as ExtractionResult;
  }

  private async upsertFact(
    organizationId: string,
    deploymentId: string,
    fact: { fact: string; confidence: number; category: string },
  ): Promise<void> {
    // Reinforcement runs first and unconditionally: incrementing confidence on
    // an existing row never grows the entry count, so the cap must NOT gate it.
    // Gating reinforcement at the cap is the "write-deafness" bug — a fact
    // repeated after the deployment fills up would never get its confidence
    // bumped.
    const existing = await this.memoryStore.findByCategory(
      organizationId,
      deploymentId,
      fact.category,
    );

    if (existing.length > 0) {
      const newEmbedding = await this.embedding.embed(fact.fact);

      for (const entry of existing) {
        const entryEmbedding = await this.embedding.embed(entry.content);
        const similarity = cosineSimilarity(newEmbedding, entryEmbedding);

        if (similarity >= SIMILARITY_THRESHOLD) {
          const newSourceCount = entry.sourceCount + 1;
          const newConfidence = computeConfidenceScore(newSourceCount, false);
          await this.memoryStore.incrementConfidence(organizationId, entry.id, newConfidence);
          return;
        }
      }
    }

    // No similar entry — this is a NEW fact, so the cap applies. At cap, admit
    // it only by evicting the lowest-value entry, and only when the newcomer
    // outranks that entry (hybrid policy). Otherwise drop it. Without this the
    // memory would freeze permanently at the cap, since nothing else deletes
    // entries (decay only lowers confidence to a floor).
    const count = await this.memoryStore.countByDeployment(organizationId, deploymentId);
    if (count >= MAX_DEPLOYMENT_MEMORY_ENTRIES) {
      const candidate = await this.memoryStore.findEvictionCandidate(organizationId, deploymentId);
      if (!candidate || NEW_FACT_CONFIDENCE <= candidate.confidence) return;
      try {
        await this.memoryStore.delete(organizationId, candidate.id);
      } catch (err) {
        // StaleVersionError means the candidate was deleted by a concurrent
        // writer between find and delete — drop this fact rather than create a
        // row without a freed slot (which would push past the cap). Any other
        // error is a real failure and must propagate to the caller's boundary.
        if (err instanceof StaleVersionError) {
          console.warn("[CompoundingService] eviction candidate vanished, dropping new fact", err);
          return;
        }
        throw err;
      }
    }

    await this.memoryStore.create({
      organizationId,
      deploymentId,
      category: fact.category,
      content: fact.fact,
      confidence: NEW_FACT_CONFIDENCE,
    });
  }

  private async trackQuestion(
    organizationId: string,
    deploymentId: string,
    question: string,
  ): Promise<void> {
    const existing = await this.memoryStore.findByCategory(organizationId, deploymentId, "faq");

    if (existing.length > 0) {
      const questionEmbedding = await this.embedding.embed(question);

      for (const entry of existing) {
        const entryEmbedding = await this.embedding.embed(entry.content);
        const similarity = cosineSimilarity(questionEmbedding, entryEmbedding);

        if (similarity >= SIMILARITY_THRESHOLD) {
          const newSourceCount = entry.sourceCount + 1;
          const newConfidence = computeConfidenceScore(newSourceCount, false);
          const result = await this.memoryStore.incrementConfidence(
            organizationId,
            entry.id,
            newConfidence,
          );

          if (result.sourceCount === FAQ_PROMOTION_THRESHOLD && this.knowledgeStore) {
            const embedding = await this.embedding.embed(entry.content);
            const draftExpiresAt = new Date(Date.now() + FAQ_DRAFT_EXPIRY_MS);
            await this.knowledgeStore.store({
              id: crypto.randomUUID(),
              organizationId,
              agentId: this.agentId,
              deploymentId,
              documentId: `faq-${entry.id}`,
              content: `Frequently asked question: ${entry.content}`,
              sourceType: "learned",
              embedding,
              chunkIndex: 0,
              metadata: { source: "faq-auto", sourceCount: result.sourceCount },
              draftStatus: "pending",
              draftExpiresAt,
            });
          }
          return;
        }
      }
    }

    await this.memoryStore.create({
      organizationId,
      deploymentId,
      category: "faq",
      content: question,
    });
  }

  private async trackPattern(
    organizationId: string,
    deploymentId: string,
    patternText: string,
    canonicalKey: string,
  ): Promise<string> {
    const metrics = getMetrics();
    const newEmbedding = await this.embedding.embed(patternText);

    // Stage 1: canonical-bucket lookup. Highest-similarity match above the
    // pilot threshold wins.
    const sameBucket = await this.memoryStore.findByCategoryAndCanonicalKey(
      organizationId,
      deploymentId,
      "pattern",
      canonicalKey,
    );

    if (sameBucket.length > 0) {
      let best: { id: string; sourceCount: number; similarity: number } | null = null;
      for (const entry of sameBucket) {
        const entryEmbedding = await this.embedding.embed(entry.content);
        const similarity = cosineSimilarity(newEmbedding, entryEmbedding);
        if (similarity >= OUTCOME_PATTERN_MERGE_THRESHOLD) {
          if (!best || similarity > best.similarity) {
            best = { id: entry.id, sourceCount: entry.sourceCount, similarity };
          }
        }
      }
      if (best) {
        const newSourceCount = best.sourceCount + 1;
        const newConfidence = computeConfidenceScore(newSourceCount, false);
        await this.memoryStore.incrementConfidence(organizationId, best.id, newConfidence);
        metrics.outcomePatternsMerged.inc({ deploymentId });
        metrics.outcomePatternConfidence.observe({ deploymentId }, newConfidence);
        return best.id;
      }
    }

    // Cross-key collision guard: a stage-1 miss with a stage-0 match outside
    // the canonical bucket signals either an under-granular enum or LLM-
    // label inconsistency. Counted, NOT auto-merged.
    const broad = await this.memoryStore.findByCategory(organizationId, deploymentId, "pattern");
    for (const entry of broad) {
      const entryCanonicalKey = entry.canonicalKey;
      if (!entryCanonicalKey || entryCanonicalKey === canonicalKey) continue;
      const entryEmbedding = await this.embedding.embed(entry.content);
      const similarity = cosineSimilarity(newEmbedding, entryEmbedding);
      if (similarity >= SIMILARITY_THRESHOLD /* legacy 0.92 */) {
        metrics.outcomePatternsCrossKeyCollision.inc({
          deploymentId,
          currentKey: canonicalKey,
          collidingKey: entryCanonicalKey,
        });
        break; // one collision per write is enough; metric is a flag, not a count
      }
    }

    const initialConfidence = computeConfidenceScore(1, false);
    try {
      const created = await this.memoryStore.create({
        organizationId,
        deploymentId,
        category: "pattern",
        content: patternText,
        canonicalKey,
        confidence: initialConfidence,
      });
      metrics.outcomePatternsCreated.inc({ deploymentId });
      metrics.outcomePatternConfidence.observe({ deploymentId }, initialConfidence);
      return created.id;
    } catch (err) {
      // The DeploymentMemory unique is on CONTENT (org, deployment, category,
      // content), NOT canonicalKey. When a row with identical content already
      // exists under a DIFFERENT canonicalKey, this create raises P2002. The
      // cross-key scan above only flags a metric (fuzzy similarity), so it
      // cannot reliably pre-empt the EXACT-content collision the unique guards.
      // Recover by re-resolving that existing row and crediting it, instead of
      // letting P2002 propagate up to processOutcomePatterns where it would be
      // swallowed and the booking-attributed evidence lost (F13).
      if (!isPrismaUniqueConstraintError(err)) throw err;
      const existing = await this.memoryStore.findByCategory(
        organizationId,
        deploymentId,
        "pattern",
      );
      const collidingRow = existing.find((entry) => entry.content === patternText);
      // If the colliding row cannot be re-resolved, the P2002 was unexpected —
      // rethrow rather than silently drop the evidence.
      if (!collidingRow) throw err;
      const newConfidence = computeConfidenceScore(collidingRow.sourceCount + 1, false);
      await this.memoryStore.incrementConfidence(organizationId, collidingRow.id, newConfidence);
      metrics.outcomePatternsMerged.inc({ deploymentId });
      metrics.outcomePatternConfidence.observe({ deploymentId }, newConfidence);
      return collidingRow.id;
    }
  }
}

/** P2002 (unique-constraint) classifier — matches Prisma's error code, not its message. */
function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
