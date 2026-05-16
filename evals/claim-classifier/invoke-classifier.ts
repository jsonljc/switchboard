import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClaimClassifier } from "@switchboard/core";
import type { FixtureRow } from "./schema.js";
import type { ClaimType } from "@switchboard/schemas";

export interface InvocationResult {
  fixtureId: string;
  expected: ClaimType;
  acceptable: ClaimType[];
  predicted: ClaimType;
  matched: boolean;
  confidence: number;
  latencyMs: number;
  promptHash: string;
  promptVersion: string;
}

export async function invokeOne(
  client: Anthropic,
  row: FixtureRow,
  signal: AbortSignal,
): Promise<InvocationResult> {
  const classifier = createAnthropicClaimClassifier(client);
  const acceptable: ClaimType[] = [row.expectedClaimType, ...(row.acceptableClaimTypes ?? [])];
  const startedAt = Date.now();
  const { result, promptHash, promptVersion } = await classifier.classify({
    sentence: row.text,
    model: "claude-haiku-4-5-20251001",
    signal,
  });
  const latencyMs = Date.now() - startedAt;
  return {
    fixtureId: row.id,
    expected: row.expectedClaimType,
    acceptable,
    predicted: result.claimType,
    matched: acceptable.includes(result.claimType),
    confidence: result.confidence,
    latencyMs,
    promptHash,
    promptVersion,
  };
}
