// ---------------------------------------------------------------------------
// Signal Health Types
// ---------------------------------------------------------------------------

export interface PixelDiagnostics {
  pixelId: string;
  pixelName: string;
  isActive: boolean;
  lastFiredTime: string | null;
  totalEventsLast24h: number;
  eventBreakdown: Array<{
    eventName: string;
    count: number;
    lastFired: string | null;
  }>;
  issues: string[];
}

export interface CAPIDiagnostics {
  pixelId: string;
  serverEventsEnabled: boolean;
  serverEventsLast24h: number;
  browserEventsLast24h: number;
  deduplicationRate: number;
  eventBreakdown: Array<{
    eventName: string;
    serverCount: number;
    browserCount: number;
    deduplicationRate: number;
  }>;
  issues: string[];
}

export interface EMQResult {
  datasetId: string;
  overallScore: number; // 1-10
  parameterScores: Array<{
    parameter: string;
    score: number;
    coverage: number;
  }>;
  recommendations: string[];
}

export interface LearningPhaseInfo {
  adSetId: string;
  adSetName: string;
  learningStage: "LEARNING" | "LEARNING_LIMITED" | "GRADUATED" | "UNKNOWN";
  eventsNeeded: number;
  eventsCurrent: number;
  daysInLearning: number;
  issues: string[];
  stuckReason: string | null;
}

export interface DeliveryDiagnostic {
  campaignId: string;
  campaignName: string;
  effectiveStatus: string;
  dailyBudget: number;
  recentSpend: number;
  recentImpressions: number;
  activeAdSetCount: number;
  totalAdSetCount: number;
  learningLimitedCount: number;
  issues: string[];
  recommendations: string[];
}
