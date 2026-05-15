import { SURFACING_THRESHOLD } from "@switchboard/schemas";
import { getMetrics } from "../telemetry/metrics.js";
import {
  filterPilotModeSurfaceable,
  filterSurfaceablePatterns,
  PILOT_SURFACING_MIN_CONFIDENCE,
  renderOutcomePatternsForContext,
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
  // PR-3.2c: IDs of pattern memories rendered into outcomePatternContext.
  // Reflects what was surfaceable; not budget-truncated (patterns are appended
  // after the budgeted chunks/facts/summaries). Empty when no patterns surfaced.
  injectedPatternIds: string[];
  totalTokenEstimate: number;
}

export interface ContextBuildInput {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  query: string;
  contactId?: string;
  tokenBudget?: number;
  // PR-3.2e: when true, ContextBuilder uses relaxed pattern-surfacing thresholds
  // (sourceCount>=2 AND confidence>=0.6, OR >=2 distinct booking-ids in evidence)
  // and lowers the listHighConfidence query so low-source patterns are visible
  // to the pilot filter. Defaults to false; flipped per-deployment via
  // AgentDeployment.inputConfig.outcomePatterns.pilotMode.
  pilotMode?: boolean;
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
      // Optional in the Layer-3 contract — the Prisma store returns it always
      // (PR-3.2a column with @default(null)), but older in-memory test fixtures
      // pre-date the column. Coalesced to null at the OutcomePattern boundary.
      canonicalKey?: string | null;
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

// PR-3.2e: optional evidence-store lookup so pilot-mode surfacing can check
// independent booking-id counts. Without it, pilot-mode degrades to the
// threshold-only branch (sourceCount>=2 AND confidence>=0.6).
export interface ContextBuilderEvidenceStore {
  countDistinctBookingIds(deploymentMemoryId: string): Promise<number>;
}

export interface ContextBuilderDeps {
  knowledgeRetriever: ContextBuilderKnowledgeRetriever;
  deploymentMemoryStore: ContextBuilderDeploymentMemoryStore;
  interactionSummaryStore: ContextBuilderInteractionSummaryStore;
  evidenceStore?: ContextBuilderEvidenceStore;
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

    // PR-3.2e: pilot mode lowers the DB-side threshold so patterns at
    // sourceCount=1 (multi-booking branch) and at the relaxed confidence
    // floor are visible to the pilot filter below. The pilot filter does
    // the actual rule check; this lookup just widens the candidate set.
    // Facts surfaced at this lower bar in pilot mode are intentional —
    // operators flip pilotMode to learn faster, which includes facts.
    const memoryMinConfidence = input.pilotMode
      ? PILOT_SURFACING_MIN_CONFIDENCE
      : SURFACING_THRESHOLD.minConfidence;
    const memoryMinSourceCount = input.pilotMode ? 1 : SURFACING_THRESHOLD.minSourceCount;

    const [chunks, memories, summaries] = await Promise.all([
      this.deps.knowledgeRetriever.retrieve(input.query, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        deploymentId: input.deploymentId,
      }),
      this.deps.deploymentMemoryStore.listHighConfidence(
        input.organizationId,
        input.deploymentId,
        memoryMinConfidence,
        memoryMinSourceCount,
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
      if (mem.category === "pattern") continue; // patterns flow via outcomePatternContext only
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
        id: m.id,
        content: m.content,
        canonicalKey: m.canonicalKey ?? null,
        category: m.category as OutcomePattern["category"],
        confidence: m.confidence,
        sourceCount: m.sourceCount,
        lastSeenAt: m.lastSeenAt,
      }));
    const surfaceable = input.pilotMode
      ? await filterPilotModeSurfaceable(outcomePatterns, this.deps.evidenceStore)
      : filterSurfaceablePatterns(outcomePatterns);
    const { rendered: outcomePatternContext, renderedIds: injectedPatternIds } =
      renderOutcomePatternsForContext(surfaceable);
    if (outcomePatternContext.length > 0) {
      getMetrics().outcomePatternsSurfaced.inc({ deploymentId: input.deploymentId });
    }

    return {
      retrievedChunks,
      learnedFacts,
      recentSummaries,
      outcomePatternContext,
      injectedPatternIds,
      totalTokenEstimate: tokensUsed + estimateTokens(outcomePatternContext),
    };
  }
}
