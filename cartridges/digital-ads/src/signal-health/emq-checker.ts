// ---------------------------------------------------------------------------
// EMQ Checker — Event Match Quality scoring
// ---------------------------------------------------------------------------

import type { EMQResult } from "./types.js";

export class EMQChecker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async check(datasetId: string): Promise<EMQResult> {
    const url =
      `${this.baseUrl}/${datasetId}?fields=event_match_quality` +
      `&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);
    const emq = data.event_match_quality as Record<string, unknown> | undefined;

    const overallScore = Number(emq?.score ?? 0);
    const parameters = (emq?.parameters ?? []) as Array<{
      parameter: string;
      score: number;
      coverage: number;
    }>;

    const parameterScores = parameters.map((p) => ({
      parameter: String(p.parameter),
      score: Number(p.score ?? 0),
      coverage: Number(p.coverage ?? 0),
    }));

    const recommendations: string[] = [];

    if (overallScore < 3) {
      recommendations.push(
        "Critical: EMQ score is very low — most customer data is not being matched",
      );
    } else if (overallScore < 6) {
      recommendations.push(
        "EMQ score is below optimal — improve data parameters for better matching",
      );
    }

    for (const param of parameterScores) {
      if (param.coverage < 0.5) {
        recommendations.push(
          `Low coverage for ${param.parameter} (${(param.coverage * 100).toFixed(0)}%) — send this parameter more consistently`,
        );
      }
    }

    const paramNames = new Set(parameterScores.map((p) => p.parameter));
    const keyParams = ["em", "ph", "fn", "ln", "ct", "st", "zp", "country"];
    for (const key of keyParams) {
      if (!paramNames.has(key)) {
        recommendations.push(`Missing parameter: ${key} — adding this can improve match quality`);
      }
    }

    return { datasetId, overallScore, parameterScores, recommendations };
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(`Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
