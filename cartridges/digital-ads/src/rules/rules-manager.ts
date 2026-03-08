// ---------------------------------------------------------------------------
// Rules Manager — Meta Ad Rules API integration
// ---------------------------------------------------------------------------

import type { AdRule, CreateRuleParams } from "./types.js";

export class RulesManager {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async create(params: CreateRuleParams): Promise<AdRule> {
    const accountId = params.adAccountId.startsWith("act_")
      ? params.adAccountId
      : `act_${params.adAccountId}`;

    const url = `${this.baseUrl}/${accountId}/adrules_library?access_token=${this.accessToken}`;
    const body = {
      name: params.name,
      evaluation_spec: params.evaluation,
      execution_spec: params.execution,
      schedule_spec: params.schedule,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = errorBody.error as Record<string, unknown> | undefined;
      throw new Error(
        `Failed to create rule: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      id: String(data.id),
      name: params.name,
      status: "ENABLED",
      evaluationType: params.evaluation.trigger.type,
      executionType: params.execution.type,
      filters: params.evaluation.filters,
      schedule: params.schedule,
      createdAt: new Date().toISOString(),
    };
  }

  async list(adAccountId: string): Promise<AdRule[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const url =
      `${this.baseUrl}/${accountId}/adrules_library?fields=` +
      "id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time" +
      `&access_token=${this.accessToken}`;

    const results: AdRule[] = [];
    let nextUrl: string | null = url;

    while (nextUrl) {
      const response = await fetch(nextUrl);
      if (!response.ok) break;
      const data = (await response.json()) as Record<string, unknown>;
      const rules = (data.data ?? []) as Record<string, unknown>[];

      for (const rule of rules) {
        const evalSpec = rule.evaluation_spec as Record<string, unknown> | undefined;
        const execSpec = rule.execution_spec as Record<string, unknown> | undefined;
        results.push({
          id: String(rule.id),
          name: String(rule.name ?? ""),
          status: (rule.status as "ENABLED" | "DISABLED") ?? "ENABLED",
          evaluationType: String(evalSpec?.type ?? ""),
          executionType: String(execSpec?.type ?? ""),
          filters: (evalSpec?.filters as AdRule["filters"]) ?? [],
          schedule: (rule.schedule_spec as AdRule["schedule"]) ?? null,
          createdAt: (rule.created_time as string) ?? null,
        });
      }

      nextUrl = ((data.paging as Record<string, unknown> | undefined)?.next as string) ?? null;
    }

    return results;
  }

  async delete(ruleId: string): Promise<{ success: boolean }> {
    const url = `${this.baseUrl}/${ruleId}?access_token=${this.accessToken}`;
    const response = await fetch(url, { method: "DELETE" });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = errorBody.error as Record<string, unknown> | undefined;
      throw new Error(
        `Failed to delete rule: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }

    return { success: true };
  }
}
