export interface MarketplaceListing {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: string;
  status: string;
  taskCategories: string[];
  trustScore: number;
  autonomyLevel: string;
  priceTier: string;
  priceMonthly: number;
  webhookUrl: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceDeployment {
  id: string;
  organizationId: string;
  listingId: string;
  status: string;
  inputConfig: Record<string, unknown>;
  governanceSettings: Record<string, unknown>;
  outputDestination: Record<string, unknown> | null;
  connectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceTask {
  id: string;
  deploymentId: string;
  organizationId: string;
  listingId: string;
  category: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  acceptanceCriteria: string | null;
  reviewResult: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeJobSummary {
  id: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
  productImages: string[];
  references: string[];
  pastPerformance: Record<string, unknown> | null;
  currentStage: string;
  stoppedAt: string | null;
  stageOutputs: Record<string, unknown>;
  productionTier: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrustScoreBreakdown {
  listingId: string;
  priceTier: string;
  breakdown: Array<{
    taskCategory: string;
    score: number;
    autonomyLevel: string;
    totalApprovals: number;
    totalRejections: number;
    consecutiveApprovals: number;
    lastActivityAt: string;
  }>;
}

export interface DraftFAQ {
  id: string;
  content: string;
  sourceType: string;
  draftStatus: string | null;
  draftExpiresAt: string | null;
  createdAt: string;
}

export interface ExecutionTraceSummary {
  id: string;
  skillSlug: string;
  status: string;
  durationMs: number;
  turnCount: number;
  writeCount: number;
  responseSummary: string;
  linkedOutcomeType?: string;
  linkedOutcomeResult?: string;
  createdAt: string;
}
