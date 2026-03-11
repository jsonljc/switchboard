export const queryKeys = {
  identity: {
    all: ["identity"] as const,
    spec: (principalId: string) => ["identity", "spec", principalId] as const,
    specById: (id: string) => ["identity", "spec-by-id", id] as const,
  },
  approvals: {
    all: ["approvals"] as const,
    pending: () => ["approvals", "pending"] as const,
    detail: (id: string) => ["approvals", "detail", id] as const,
  },
  audit: {
    all: ["audit"] as const,
    list: (filters?: Record<string, string | undefined>) => ["audit", "list", filters] as const,
  },
  policies: {
    all: ["policies"] as const,
    list: () => ["policies", "list"] as const,
  },
  health: {
    all: ["health"] as const,
    deep: () => ["health", "deep"] as const,
  },
  spend: {
    all: ["spend"] as const,
    summary: () => ["spend", "summary"] as const,
  },
  tokenUsage: {
    all: ["tokenUsage"] as const,
    summary: (period?: string) => ["tokenUsage", "summary", period] as const,
    trend: (days?: number) => ["tokenUsage", "trend", days] as const,
  },
  cartridges: {
    all: ["cartridges"] as const,
    list: () => ["cartridges", "list"] as const,
  },
  connections: {
    all: ["connections"] as const,
    list: () => ["connections", "list"] as const,
  },
  channels: {
    all: ["channels"] as const,
    list: () => ["channels", "list"] as const,
  },
  orgConfig: {
    all: ["orgConfig"] as const,
    current: () => ["orgConfig", "current"] as const,
  },
  alerts: {
    all: ["alerts"] as const,
    list: () => ["alerts", "list"] as const,
    history: (id: string) => ["alerts", "history", id] as const,
  },
  scheduledReports: {
    all: ["scheduledReports"] as const,
    list: () => ["scheduledReports", "list"] as const,
  },
  competence: {
    all: ["competence"] as const,
    records: (principalId?: string) => ["competence", "records", principalId] as const,
    policies: () => ["competence", "policies"] as const,
  },
  dlq: {
    all: ["dlq"] as const,
    list: (status?: string) => ["dlq", "list", status] as const,
    stats: () => ["dlq", "stats"] as const,
  },
  crm: {
    all: ["crm"] as const,
    contacts: () => ["crm", "contacts"] as const,
    deals: () => ["crm", "deals"] as const,
  },
  agents: {
    all: ["agents"] as const,
    roster: () => ["agents", "roster"] as const,
    state: () => ["agents", "state"] as const,
  },
  operatorConfig: {
    all: ["operatorConfig"] as const,
    current: () => ["operatorConfig", "current"] as const,
    autonomy: () => ["operatorConfig", "autonomy"] as const,
  },
  revenueGrowth: {
    all: ["revenueGrowth"] as const,
    diagnostic: (accountId: string) => ["revenueGrowth", "diagnostic", accountId] as const,
    connectors: (accountId: string) => ["revenueGrowth", "connectors", accountId] as const,
    interventions: (accountId: string) => ["revenueGrowth", "interventions", accountId] as const,
    digest: (accountId: string) => ["revenueGrowth", "digest", accountId] as const,
  },
};
