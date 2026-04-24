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
  tokenUsage: {
    all: ["tokenUsage"] as const,
    summary: (period?: string) => ["tokenUsage", "summary", period] as const,
    trend: (days?: number) => ["tokenUsage", "trend", days] as const,
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
  conversations: {
    all: ["conversations"] as const,
    list: (filters?: Record<string, string | undefined>) =>
      ["conversations", "list", filters] as const,
    detail: (id: string) => ["conversations", "detail", id] as const,
  },
  agents: {
    all: ["agents"] as const,
    roster: () => ["agents", "roster"] as const,
    state: () => ["agents", "state"] as const,
    activity: () => ["agents", "activity"] as const,
  },
  inbox: {
    all: ["inbox"] as const,
    list: () => ["inbox", "list"] as const,
    count: () => ["inbox", "count"] as const,
  },
  operatorConfig: {
    all: ["operatorConfig"] as const,
    current: () => ["operatorConfig", "current"] as const,
    autonomy: () => ["operatorConfig", "autonomy"] as const,
  },
  knowledge: {
    all: ["knowledge"] as const,
    documents: (agentId?: string) => ["knowledge", "documents", agentId] as const,
  },
  escalations: {
    all: ["escalations"] as const,
  },
  governance: {
    all: ["governance"] as const,
    status: (orgId: string) => ["governance", "status", orgId] as const,
  },
  readiness: {
    all: ["readiness"] as const,
    check: (agentId: string) => ["readiness", "check", agentId] as const,
  },
  marketplace: {
    all: ["marketplace"] as const,
    listings: (filters?: Record<string, string | undefined>) =>
      ["marketplace", "listings", filters] as const,
    listing: (id: string) => ["marketplace", "listing", id] as const,
    trust: (id: string) => ["marketplace", "trust", id] as const,
    trustProgression: (id: string) => ["marketplace", "trust-progression", id] as const,
    deployments: () => ["marketplace", "deployments"] as const,
    faqDrafts: (deploymentId: string) => ["marketplace", "faq-drafts", deploymentId] as const,
    traces: (deploymentId: string) => ["marketplace", "traces", deploymentId] as const,
    trace: (traceId: string) => ["marketplace", "trace", traceId] as const,
  },
  creativeJobs: {
    all: ["creativeJobs"] as const,
    list: (deploymentId: string) => ["creativeJobs", "list", deploymentId] as const,
    detail: (id: string) => ["creativeJobs", "detail", id] as const,
    estimate: (id: string) => ["creativeJobs", "estimate", id] as const,
  },
  adOptimizer: {
    all: ["adOptimizer"] as const,
    audit: (deploymentId: string) => ["adOptimizer", "audit", deploymentId] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    list: (filters?: Record<string, string | undefined>) => ["tasks", "list", filters] as const,
  },
  persona: {
    all: ["persona"] as const,
    mine: () => [...queryKeys.persona.all, "mine"] as const,
  },
  playbook: {
    all: ["playbook"] as const,
    current: () => [...queryKeys.playbook.all, "current"] as const,
  },
  scan: {
    all: ["scan"] as const,
  },
  modules: {
    all: ["modules"] as const,
    status: () => [...queryKeys.modules.all, "status"] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    overview: () => ["dashboard", "overview"] as const,
  },
};
