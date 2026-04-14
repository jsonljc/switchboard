// ---------------------------------------------------------------------------
// Confidence Scorer — per-action confidence evaluation
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ConfidenceInput {
  /** Risk score from the risk scorer (0-100) */
  riskScore: number;
  /** Are all action parameters present and valid against schema? */
  schemaComplete: boolean;
  /** Are the required params specifically provided (not defaults)? */
  hasRequiredParams: boolean;
  /** Quality of retrieved knowledge (0-1), if applicable */
  retrievalQuality?: number;
  /** Historical success rate of this tool (0-1), if tracked */
  toolSuccessRate?: number;
}

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  factors: Array<{ signal: string; value: number; weight: number }>;
}

const THRESHOLDS = { high: 0.75, medium: 0.45 } as const;

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const factors: ConfidenceResult["factors"] = [];

  const riskFactor = Math.max(0, 1 - input.riskScore / 100);
  factors.push({ signal: "risk_score", value: riskFactor, weight: 0.3 });

  const schemaFactor = input.schemaComplete && input.hasRequiredParams ? 1.0 : 0.2;
  factors.push({ signal: "schema_complete", value: schemaFactor, weight: 0.3 });

  const retrievalFactor = input.retrievalQuality ?? 0.7;
  factors.push({ signal: "retrieval_quality", value: retrievalFactor, weight: 0.2 });

  const toolFactor = input.toolSuccessRate ?? 0.8;
  factors.push({ signal: "tool_success_rate", value: toolFactor, weight: 0.2 });

  const score = factors.reduce((sum, f) => sum + f.value * f.weight, 0);

  const level: ConfidenceLevel =
    score >= THRESHOLDS.high ? "high" : score >= THRESHOLDS.medium ? "medium" : "low";

  return { score, level, factors };
}
