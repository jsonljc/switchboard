import type {
  ParkedApprovalContext,
  ParkedApprovalSummarizer,
  ParkedApprovalSummary,
} from "@switchboard/core";

// Per-intent operator cards for parked governed-workflow approvals. Lives next
// to the workflow modules that own these parameter shapes (see
// recommendation-handoff-request.ts, creative-publish-workflow.ts). Reads are
// defensive: a malformed parameter never breaks the feed, it just degrades the
// copy. Intents without an entry get the adapter's default card (which fails
// closed toward caution).

function str(params: Record<string, unknown>, key: string): string | null {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function obj(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(params: Record<string, unknown>, key: string): number | null {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const handoffCard: ParkedApprovalSummarizer = ({ parameters }) => {
  const campaignId = str(parameters, "campaignId") ?? "an active campaign";
  const rationale = str(parameters, "rationale");
  const evidence = obj(parameters, "evidence");
  const brief = obj(parameters, "brief");
  const clicks = num(evidence, "clicks");
  const conversions = num(evidence, "conversions");
  const days = num(evidence, "days");

  const dataLines: Array<string | string[]> = [];
  if (clicks !== null && conversions !== null && days !== null) {
    dataLines.push(`Evidence: ${clicks} clicks, ${conversions} conversions over ${days} days`);
  }
  const product = str(brief, "productDescription");
  if (product) dataLines.push(`Brief: ${product}`);
  const audience = str(brief, "targetAudience");
  if (audience) dataLines.push(`Audience: ${audience}`);
  if (parameters["learningPhaseActive"] === true) {
    dataLines.push("Campaign is still in its learning phase");
  }

  return {
    humanSummary: rationale
      ? `Riley wants to brief Mira to refresh creative on campaign ${campaignId}: ${rationale}`
      : `Riley wants to brief Mira to refresh creative on campaign ${campaignId}.`,
    dataLines,
    presentation: { primaryLabel: "Approve handoff" },
    riskContract: {
      // The handoff itself only creates a Mira draft; spend stays gated behind
      // its own approval. Medium risk, no direct external/financial effect.
      riskLevel: "medium",
      externalEffect: false,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: true,
    },
  };
};

const publishCard: ParkedApprovalSummarizer = ({ parameters }) => {
  const jobId = str(parameters, "jobId") ?? "a kept creative";
  return {
    humanSummary: `Mira wants to publish creative ${jobId} to Meta as a paused draft package. It will not spend until you activate it in Meta.`,
    dataLines: [
      "Publishes a PAUSED draft to the connected Meta ad account",
      "No spend until you activate it in Meta",
    ],
    presentation: { primaryLabel: "Approve publish" },
    riskContract: {
      // Creates a Meta-side object (external) but a paused draft cannot spend
      // (not financial) and is never shown to clients.
      riskLevel: "high",
      externalEffect: true,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: true,
    },
  };
};

const PARKED_INTENT_CARDS: Record<string, ParkedApprovalSummarizer> = {
  "adoptimizer.recommendation.handoff": handoffCard,
  "creative.job.publish": publishCard,
};

/** Single summarizer handed to adaptParkedApproval; null falls through to the default card. */
export function summarizeParkedIntent(ctx: ParkedApprovalContext): ParkedApprovalSummary | null {
  const card = PARKED_INTENT_CARDS[ctx.intent];
  return card ? card(ctx) : null;
}
