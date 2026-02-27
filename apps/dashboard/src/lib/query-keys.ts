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
    list: (filters?: Record<string, string | undefined>) =>
      ["audit", "list", filters] as const,
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
};
