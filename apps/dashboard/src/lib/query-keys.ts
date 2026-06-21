/**
 * Tenant-scoped React Query key factory.
 *
 * Every cache key is prefixed with the active orgId so that:
 *   1. A signed-in user can never observe another org's cached data.
 *   2. signOut → queryClient.clear() purges cleanly without leaking across
 *      sessions (because keys for a different org never collide).
 *
 * Consumers use `useScopedQueryKeys()` (apps/dashboard/src/hooks/use-query-keys.ts),
 * which returns `null` when the session has no organizationId and otherwise
 * returns this factory bound to the current org.
 */
export const scopedKeys = (orgId: string) => ({
  identity: {
    all: () => [orgId, "identity"] as const,
    spec: (principalId: string) => [orgId, "identity", "spec", principalId] as const,
    specById: (id: string) => [orgId, "identity", "spec-by-id", id] as const,
  },
  approvals: {
    all: () => [orgId, "approvals"] as const,
    pending: () => [orgId, "approvals", "pending"] as const,
    detail: (id: string) => [orgId, "approvals", "detail", id] as const,
  },
  audit: {
    all: () => [orgId, "audit"] as const,
    list: (filters?: Record<string, string | undefined>) =>
      [orgId, "audit", "list", filters] as const,
  },
  policies: {
    all: () => [orgId, "policies"] as const,
    list: () => [orgId, "policies", "list"] as const,
  },
  health: {
    all: () => [orgId, "health"] as const,
    deep: () => [orgId, "health", "deep"] as const,
  },
  tokenUsage: {
    all: () => [orgId, "tokenUsage"] as const,
    summary: (period?: string) => [orgId, "tokenUsage", "summary", period] as const,
    trend: (days?: number) => [orgId, "tokenUsage", "trend", days] as const,
  },
  connections: {
    all: () => [orgId, "connections"] as const,
    list: () => [orgId, "connections", "list"] as const,
  },
  channels: {
    all: () => [orgId, "channels"] as const,
    list: () => [orgId, "channels", "list"] as const,
  },
  orgConfig: {
    all: () => [orgId, "orgConfig"] as const,
    current: () => [orgId, "orgConfig", "current"] as const,
  },
  competence: {
    all: () => [orgId, "competence"] as const,
    records: (principalId?: string) => [orgId, "competence", "records", principalId] as const,
    policies: () => [orgId, "competence", "policies"] as const,
  },
  dlq: {
    all: () => [orgId, "dlq"] as const,
    list: (status?: string) => [orgId, "dlq", "list", status] as const,
    stats: () => [orgId, "dlq", "stats"] as const,
  },
  conversations: {
    all: () => [orgId, "conversations"] as const,
    list: (filters?: Record<string, string | undefined>) =>
      [orgId, "conversations", "list", filters] as const,
    detail: (id: string) => [orgId, "conversations", "detail", id] as const,
  },
  agents: {
    all: () => [orgId, "agents"] as const,
    roster: () => [orgId, "agents", "roster"] as const,
    state: () => [orgId, "agents", "state"] as const,
    activity: () => [orgId, "agents", "activity"] as const,
    activityCockpit: (agentId: string) => [orgId, "agents", "activity-cockpit", agentId] as const,
  },
  inbox: {
    all: () => [orgId, "inbox"] as const,
    list: () => [orgId, "inbox", "list"] as const,
    count: () => [orgId, "inbox", "count"] as const,
  },
  knowledge: {
    all: () => [orgId, "knowledge"] as const,
    documents: (agentId?: string) => [orgId, "knowledge", "documents", agentId] as const,
  },
  escalations: {
    all: () => [orgId, "escalations"] as const,
    detail: (id: string) => [orgId, "escalations", "detail", id] as const,
  },
  governance: {
    all: () => [orgId, "governance"] as const,
    status: (id: string) => [orgId, "governance", "status", id] as const,
  },
  readiness: {
    all: () => [orgId, "readiness"] as const,
    check: (agentId: string) => [orgId, "readiness", "check", agentId] as const,
  },
  recommendations: {
    all: () => [orgId, "recommendations"] as const,
    queue: () => [orgId, "recommendations", "queue"] as const,
    shadow: () => [orgId, "recommendations", "shadow"] as const,
  },
  marketplace: {
    all: () => [orgId, "marketplace"] as const,
    listings: (filters?: Record<string, string | undefined>) =>
      [orgId, "marketplace", "listings", filters] as const,
    listing: (id: string) => [orgId, "marketplace", "listing", id] as const,
    trust: (id: string) => [orgId, "marketplace", "trust", id] as const,
    trustProgression: (id: string) => [orgId, "marketplace", "trust-progression", id] as const,
    deployments: () => [orgId, "marketplace", "deployments"] as const,
    businessFacts: (deploymentId: string) =>
      [orgId, "marketplace", "business-facts", deploymentId] as const,
    operationalState: (deploymentId: string) =>
      [orgId, "marketplace", "operational-state", deploymentId] as const,
    deploymentForModule: (moduleId: string) =>
      [orgId, "marketplace", "deployment-for-module", moduleId] as const,
    faqDrafts: (deploymentId: string) =>
      [orgId, "marketplace", "faq-drafts", deploymentId] as const,
    traces: (deploymentId: string) => [orgId, "marketplace", "traces", deploymentId] as const,
    trace: (traceId: string) => [orgId, "marketplace", "trace", traceId] as const,
  },
  creativeJobs: {
    all: () => [orgId, "creativeJobs"] as const,
    list: (deploymentId: string) => [orgId, "creativeJobs", "list", deploymentId] as const,
    detail: (id: string) => [orgId, "creativeJobs", "detail", id] as const,
    estimate: (id: string) => [orgId, "creativeJobs", "estimate", id] as const,
  },
  miraFeed: {
    all: () => [orgId, "miraFeed"] as const,
    list: () => [orgId, "miraFeed", "list"] as const,
    detail: (id: string) => [orgId, "miraFeed", "detail", id] as const,
    desk: () => [orgId, "miraFeed", "desk"] as const,
  },
  adOptimizer: {
    all: () => [orgId, "adOptimizer"] as const,
    audit: (deploymentId: string) => [orgId, "adOptimizer", "audit", deploymentId] as const,
  },
  tasks: {
    all: () => [orgId, "tasks"] as const,
    list: (filters?: Record<string, string | undefined>) =>
      [orgId, "tasks", "list", filters] as const,
  },
  persona: {
    all: () => [orgId, "persona"] as const,
    mine: () => [orgId, "persona", "mine"] as const,
  },
  playbook: {
    all: () => [orgId, "playbook"] as const,
    current: () => [orgId, "playbook", "current"] as const,
  },
  scan: {
    all: () => [orgId, "scan"] as const,
  },
  rileyOutcomes: {
    all: () => [orgId, "rileyOutcomes"] as const,
    feed: () => [orgId, "rileyOutcomes", "feed"] as const,
  },
  modules: {
    all: () => [orgId, "modules"] as const,
    status: () => [orgId, "modules", "status"] as const,
  },
  dashboard: {
    all: () => [orgId, "dashboard"] as const,
    overview: () => [orgId, "dashboard", "overview"] as const,
  },
  decisions: {
    all: () => [orgId, "decisions"] as const,
    feed: (agentKey: string | null) => [orgId, "decisions", "feed", agentKey ?? "all"] as const,
  },
  greeting: {
    all: () => [orgId, "greeting"] as const,
    feed: (agentKey: string) => [orgId, "greeting", "feed", agentKey] as const,
  },
  mission: {
    all: () => [orgId, "mission"] as const,
    detail: (agentKey: string) => [orgId, "mission", "detail", agentKey] as const,
  },
  wins: {
    all: () => [orgId, "wins"] as const,
    feed: (agentKey: string, window: "today" | "week" | "month") =>
      [orgId, "wins", "feed", agentKey, window] as const,
    /** Use for prefix invalidation across all windows. */
    byAgent: (agentKey: string) => [orgId, "wins", "feed", agentKey] as const,
  },
  metrics: {
    all: () => [orgId, "metrics"] as const,
    feed: (agentKey: string, window: string) =>
      [orgId, "metrics", "feed", agentKey, window] as const,
    byAgent: (agentKey: string) => [orgId, "metrics", "feed", agentKey] as const,
  },
  homeSummary: {
    all: () => [orgId, "homeSummary"] as const,
    feed: () => [orgId, "homeSummary", "feed"] as const,
  },
  pipeline: {
    all: () => [orgId, "pipeline"] as const,
    feed: (agentKey: string) => [orgId, "pipeline", "feed", agentKey] as const,
  },
  bookingWins: {
    all: () => [orgId, "bookingWins"] as const,
    feed: (agentKey: string) => [orgId, "bookingWins", "feed", agentKey] as const,
  },
  billing: {
    all: () => [orgId, "billing"] as const,
    status: () => [orgId, "billing", "status"] as const,
  },
  roi: {
    all: () => [orgId, "roi"] as const,
    summary: (filters?: Record<string, string | undefined>) =>
      [orgId, "roi", "summary", filters] as const,
  },
  reports: {
    all: () => [orgId, "reports"] as const,
    byWindow: (window: string) => [orgId, "reports", window] as const,
  },
  paidVisits: {
    all: () => [orgId, "paid-visits"] as const,
    byWindow: (window: string) => [orgId, "paid-visits", window] as const,
  },
  opportunities: {
    all: () => [orgId, "opportunities"] as const,
    board: () => [orgId, "opportunities", "board"] as const,
  },
  contacts: {
    all: () => [orgId, "contacts"] as const,
    list: (query: object) => [orgId, "contacts", "list", query] as const,
    detail: (id: string) => [orgId, "contacts", "detail", id] as const,
  },
  automations: {
    all: () => [orgId, "automations"] as const,
    list: (query: object) => [orgId, "automations", "list", query] as const,
  },
  activity: {
    all: () => [orgId, "activity"] as const,
    list: (query: {
      scope?: string;
      cursor?: string;
      eventType?: string;
      actorType?: string;
      entityType?: string;
      entityId?: string;
      after?: string;
      before?: string;
    }) =>
      [
        orgId,
        "activity",
        "list",
        {
          scope: query.scope ?? "operational",
          cursor: query.cursor,
          eventType: query.eventType,
          actorType: query.actorType,
          entityType: query.entityType,
          entityId: query.entityId,
          after: query.after,
          before: query.before,
        },
      ] as const,
  },
  whatsappManagement: {
    all: () => [orgId, "whatsappManagement"] as const,
    account: () => [orgId, "whatsappManagement", "account"] as const,
    phoneNumbers: () => [orgId, "whatsappManagement", "phoneNumbers"] as const,
    templates: () => [orgId, "whatsappManagement", "templates"] as const,
  },
});
