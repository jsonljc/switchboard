import type { ConversationEndEvent, EmbeddingAdapter } from "@switchboard/core";
import { computeConfidenceScore } from "@switchboard/schemas";
import { buildSummarizationPrompt, buildFactExtractionPrompt } from "./extraction-prompts.js";

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
  ): Promise<Array<{ id: string; content: string; sourceCount: number; confidence: number }>>;
  create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
  }): Promise<{ id: string }>;
  incrementConfidence(
    id: string,
    newConfidence: number,
  ): Promise<{ id: string; sourceCount: number }>;
  countByDeployment(organizationId: string, deploymentId: string): Promise<number>;
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
  agentId?: string;
}

const MIN_MESSAGES = 2;
const SIMILARITY_THRESHOLD = 0.92;
const MAX_MEMORY_ENTRIES = 500;
const FAQ_PROMOTION_THRESHOLD = 3;
const FAQ_DRAFT_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours

interface SummarizationResult {
  summary: string;
  outcome: string;
}

interface ExtractionResult {
  facts: Array<{ fact: string; confidence: number; category: string }>;
  questions: string[];
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
  private readonly agentId: string;

  constructor(deps: CompoundingDeps) {
    this.llm = deps.llmClient;
    this.embedding = deps.embeddingAdapter;
    this.summaryStore = deps.interactionSummaryStore;
    this.memoryStore = deps.deploymentMemoryStore;
    this.knowledgeStore = deps.knowledgeStore;
    this.agentId = deps.agentId ?? "default";
  }

  async processConversationEnd(event: ConversationEndEvent): Promise<void> {
    if (event.messages.length < MIN_MESSAGES) return;

    try {
      const [summarization, extraction] = await Promise.all([
        this.summarize(event.messages),
        this.extractFacts(event.messages),
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
    } catch (err) {
      console.error("[CompoundingService] Failed to process conversation end:", err);
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
  ): Promise<ExtractionResult> {
    const prompt = buildFactExtractionPrompt(messages);
    const raw = await this.llm.complete(prompt);
    return JSON.parse(raw) as ExtractionResult;
  }

  private async upsertFact(
    organizationId: string,
    deploymentId: string,
    fact: { fact: string; confidence: number; category: string },
  ): Promise<void> {
    const count = await this.memoryStore.countByDeployment(organizationId, deploymentId);
    if (count >= MAX_MEMORY_ENTRIES) return;

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
          await this.memoryStore.incrementConfidence(entry.id, newConfidence);
          return;
        }
      }
    }

    await this.memoryStore.create({
      organizationId,
      deploymentId,
      category: fact.category,
      content: fact.fact,
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
          const result = await this.memoryStore.incrementConfidence(entry.id, newConfidence);

          if (result.sourceCount >= FAQ_PROMOTION_THRESHOLD && this.knowledgeStore) {
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
}
