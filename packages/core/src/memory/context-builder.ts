import { SURFACING_THRESHOLD } from "@switchboard/schemas";
import {
  filterSurfaceablePatterns,
  formatOutcomePatternsForContext,
  type OutcomePattern,
} from "./outcome-pattern-extractor.js";

export interface ContextRetrievedChunk {
  content: string;
  sourceType: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface ContextLearnedFact {
  content: string;
  category: string;
  confidence: number;
  sourceCount: number;
}

export interface ContextSummary {
  summary: string;
  outcome: string;
  createdAt: Date;
}

export interface BuiltContext {
  retrievedChunks: ContextRetrievedChunk[];
  learnedFacts: ContextLearnedFact[];
  recentSummaries: ContextSummary[];
  outcomePatternContext: string;
  totalTokenEstimate: number;
}

export interface ContextBuildInput {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  query: string;
  contactId?: string;
  tokenBudget?: number;
}

export interface ContextBuilderKnowledgeRetriever {
  retrieve(
    query: string,
    options: { organizationId: string; agentId: string; deploymentId?: string },
  ): Promise<ContextRetrievedChunk[]>;
}

export interface ContextBuilderDeploymentMemoryStore {
  listHighConfidence(
    organizationId: string,
    deploymentId: string,
    minConfidence: number,
    minSourceCount: number,
  ): Promise<
    Array<{
      id: string;
      content: string;
      category: string;
      confidence: number;
      sourceCount: number;
      lastSeenAt: Date;
    }>
  >;
}

export interface ContextBuilderInteractionSummaryStore {
  listByDeployment(
    organizationId: string,
    deploymentId: string,
    options?: { limit?: number; contactId?: string },
  ): Promise<Array<{ id: string; summary: string; outcome: string; createdAt: Date }>>;
}

export interface ContextBuilderDeps {
  knowledgeRetriever: ContextBuilderKnowledgeRetriever;
  deploymentMemoryStore: ContextBuilderDeploymentMemoryStore;
  interactionSummaryStore: ContextBuilderInteractionSummaryStore;
}

const DEFAULT_TOKEN_BUDGET = 4000;

const SOURCE_PRIORITY: Record<string, number> = {
  correction: 0,
  wizard: 1,
  learned: 2,
  document: 3,
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ContextBuilder {
  constructor(private deps: ContextBuilderDeps) {}

  async build(input: ContextBuildInput): Promise<BuiltContext> {
    const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    let tokensUsed = 0;

    const [chunks, memories, summaries] = await Promise.all([
      this.deps.knowledgeRetriever.retrieve(input.query, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        deploymentId: input.deploymentId,
      }),
      this.deps.deploymentMemoryStore.listHighConfidence(
        input.organizationId,
        input.deploymentId,
        SURFACING_THRESHOLD.minConfidence,
        SURFACING_THRESHOLD.minSourceCount,
      ),
      input.contactId
        ? this.deps.interactionSummaryStore.listByDeployment(
            input.organizationId,
            input.deploymentId,
            {
              limit: 3,
              contactId: input.contactId,
            },
          )
        : Promise.resolve([]),
    ]);

    const retrievedChunks: ContextRetrievedChunk[] = [];
    const sortedChunks = [...chunks].sort((a, b) => {
      const pDiff = (SOURCE_PRIORITY[a.sourceType] ?? 9) - (SOURCE_PRIORITY[b.sourceType] ?? 9);
      if (pDiff !== 0) return pDiff;
      return b.similarity - a.similarity;
    });
    for (const chunk of sortedChunks) {
      const tokens = estimateTokens(chunk.content);
      if (tokensUsed + tokens > budget) break;
      retrievedChunks.push(chunk);
      tokensUsed += tokens;
    }

    const learnedFacts: ContextLearnedFact[] = [];
    for (const mem of memories) {
      if (mem.category === "pattern") continue;
      const tokens = estimateTokens(mem.content);
      if (tokensUsed + tokens > budget) break;
      learnedFacts.push({
        content: mem.content,
        category: mem.category,
        confidence: mem.confidence,
        sourceCount: mem.sourceCount,
      });
      tokensUsed += tokens;
    }

    const recentSummaries: ContextSummary[] = [];
    for (const sum of summaries) {
      const tokens = estimateTokens(sum.summary);
      if (tokensUsed + tokens > budget) break;
      recentSummaries.push({
        summary: sum.summary,
        outcome: sum.outcome,
        createdAt: sum.createdAt,
      });
      tokensUsed += tokens;
    }

    const outcomePatterns: OutcomePattern[] = memories
      .filter((m) => m.category === "pattern")
      .map((m) => ({
        content: m.content,
        category: m.category as OutcomePattern["category"],
        confidence: m.confidence,
        sourceCount: m.sourceCount,
        lastSeenAt: m.lastSeenAt,
      }));
    const surfaceable = filterSurfaceablePatterns(outcomePatterns);
    const outcomePatternContext = formatOutcomePatternsForContext(surfaceable);

    return {
      retrievedChunks,
      learnedFacts,
      recentSummaries,
      outcomePatternContext,
      totalTokenEstimate: tokensUsed + estimateTokens(outcomePatternContext),
    };
  }
}
