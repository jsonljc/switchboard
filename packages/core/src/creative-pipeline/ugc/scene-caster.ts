// packages/core/src/creative-pipeline/ugc/scene-caster.ts
import type { CreatorIdentity, CreativeWeights } from "@switchboard/schemas";
import type { StructureSelection } from "./structure-engine.js";

// ── Types ──

export interface CastingAssignment {
  creatorId: string;
  structureId: string;
  score: number;
}

interface PerformanceMemory {
  structureHistory: Record<string, unknown>;
  creatorHistory: Record<string, unknown>;
}

export interface CastingInput {
  structures: StructureSelection[];
  creatorPool: CreatorIdentity[];
  platforms: string[];
  creativeWeights: CreativeWeights;
  performanceMemory: PerformanceMemory;
  recentCastings: Array<{ creatorId: string; structureId: string }>;
}

// ── Scoring ──

const REPETITION_PENALTY = 0.3;

function scoreCreatorForStructure(
  creator: CreatorIdentity,
  structure: StructureSelection,
  input: CastingInput,
): number {
  // Base score from structure selection
  let score = structure.score;

  // Energy affinity: energetic creators suit hook-heavy structures
  const energy = (creator.personality as { energy?: string }).energy ?? "conversational";
  if (energy === "energetic" || energy === "intense") {
    score += 0.1; // slight boost for high-energy creators
  }

  // Repetition penalty
  const wasRecentlyCast = input.recentCastings.some(
    (c) => c.creatorId === creator.id && c.structureId === structure.structureId,
  );
  if (wasRecentlyCast) {
    score -= REPETITION_PENALTY;
  }

  return Math.max(score, 0);
}

/**
 * Assigns creators to structures by scoring all creator × structure pairs
 * and selecting the best assignments.
 */
export function castCreators(input: CastingInput): CastingAssignment[] {
  const { structures, creatorPool } = input;

  if (creatorPool.length === 0 || structures.length === 0) return [];

  // Score all creator × structure combinations
  const allScores: Array<{ creatorId: string; structureId: string; score: number }> = [];

  for (const creator of creatorPool) {
    for (const structure of structures) {
      const score = scoreCreatorForStructure(creator, structure, input);
      allScores.push({ creatorId: creator.id, structureId: structure.structureId, score });
    }
  }

  // Sort by score descending
  allScores.sort((a, b) => b.score - a.score);

  // Greedy assignment: each creator gets their best available structure
  const assignedCreators = new Set<string>();
  const assignments: CastingAssignment[] = [];

  for (const candidate of allScores) {
    if (assignedCreators.has(candidate.creatorId)) continue;
    assignedCreators.add(candidate.creatorId);
    assignments.push(candidate);
  }

  return assignments;
}
