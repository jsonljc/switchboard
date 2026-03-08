// ---------------------------------------------------------------------------
// Rules Management Types
// ---------------------------------------------------------------------------

export interface AdRule {
  id: string;
  name: string;
  status: "ENABLED" | "DISABLED";
  evaluationType: string;
  executionType: string;
  filters: Array<{ field: string; operator: string; value: unknown }>;
  schedule: { type: string; interval?: number } | null;
  createdAt: string | null;
}

export interface CreateRuleParams {
  adAccountId: string;
  name: string;
  schedule: { type: string; interval?: number };
  evaluation: {
    filters: Array<{ field: string; operator: string; value: unknown }>;
    trigger: { type: string; field: string; operator: string; value: unknown };
  };
  execution: { type: string; field?: string; value?: unknown };
}
