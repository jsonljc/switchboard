// ---------------------------------------------------------------------------
// Learning Phase Tracker — Learning phase state tracking
// ---------------------------------------------------------------------------

import type { LearningPhaseInfo } from "./types.js";

export class LearningPhaseTracker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async checkAdSet(adSetId: string): Promise<LearningPhaseInfo> {
    const url =
      `${this.baseUrl}/${adSetId}?fields=` +
      "id,name,learning_stage_info,issues_info,start_time,effective_status" +
      `&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);
    const learningInfo = data.learning_stage_info as Record<string, unknown> | undefined;
    const issuesInfo = data.issues_info as Array<Record<string, unknown>> | undefined;

    const learningStage = (learningInfo?.status as string) ?? "UNKNOWN";
    const eventsNeeded = Number(learningInfo?.events_needed ?? 50);
    const eventsCurrent = Number(learningInfo?.events_current ?? 0);

    const startTime = data.start_time as string | undefined;
    const daysInLearning = startTime
      ? Math.floor((Date.now() - new Date(startTime).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const issues: string[] = [];
    let stuckReason: string | null = null;

    if (learningStage === "LEARNING_LIMITED") {
      stuckReason = "Ad set is in Learning Limited — not getting enough optimization events";
      issues.push(stuckReason);
      issues.push("Consider: increasing budget, broadening targeting, or combining ad sets");
    }

    if (learningStage === "LEARNING" && daysInLearning > 7) {
      stuckReason = `Ad set has been in learning phase for ${daysInLearning} days`;
      issues.push(stuckReason);
      issues.push("Learning phase typically completes within 7 days — investigate delivery issues");
    }

    if (issuesInfo) {
      for (const issue of issuesInfo) {
        issues.push(String(issue.message ?? issue.summary ?? ""));
      }
    }

    return {
      adSetId,
      adSetName: String(data.name ?? ""),
      learningStage: learningStage as LearningPhaseInfo["learningStage"],
      eventsNeeded,
      eventsCurrent,
      daysInLearning,
      issues,
      stuckReason,
    };
  }

  async checkAllAdSets(adAccountId: string): Promise<LearningPhaseInfo[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const url =
      `${this.baseUrl}/${accountId}/adsets?fields=` +
      "id,name,learning_stage_info,issues_info,start_time,effective_status" +
      `&effective_status=["ACTIVE"]` +
      `&access_token=${this.accessToken}`;

    const results: LearningPhaseInfo[] = [];
    let nextUrl: string | null = url;

    while (nextUrl) {
      const data = await this.fetchJson(nextUrl);
      const adSets = (data.data ?? []) as Record<string, unknown>[];

      for (const adSet of adSets) {
        const learningInfo = adSet.learning_stage_info as Record<string, unknown> | undefined;
        const learningStage = (learningInfo?.status as string) ?? "UNKNOWN";
        const issuesInfo = adSet.issues_info as Array<Record<string, unknown>> | undefined;
        const startTime = adSet.start_time as string | undefined;
        const daysInLearning = startTime
          ? Math.floor((Date.now() - new Date(startTime).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        const issues: string[] = [];
        let stuckReason: string | null = null;

        if (learningStage === "LEARNING_LIMITED") {
          stuckReason = "Ad set is in Learning Limited";
          issues.push(stuckReason);
        }
        if (learningStage === "LEARNING" && daysInLearning > 7) {
          stuckReason = `Stuck in learning for ${daysInLearning} days`;
          issues.push(stuckReason);
        }
        if (issuesInfo) {
          for (const issue of issuesInfo) {
            issues.push(String(issue.message ?? issue.summary ?? ""));
          }
        }

        results.push({
          adSetId: String(adSet.id),
          adSetName: String(adSet.name ?? ""),
          learningStage: learningStage as LearningPhaseInfo["learningStage"],
          eventsNeeded: Number(learningInfo?.events_needed ?? 50),
          eventsCurrent: Number(learningInfo?.events_current ?? 0),
          daysInLearning,
          issues,
          stuckReason,
        });
      }

      nextUrl = ((data.paging as Record<string, unknown> | undefined)?.next as string) ?? null;
    }

    return results;
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
