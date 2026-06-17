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

const MS_PER_HOUR = 3_600_000;

/**
 * Human expiry line for a parked card: "Expires <ISO date> (~N hours left)" so operators
 * see a real countdown instead of discovering a silent park expiry. parkedAt is shown for
 * provenance. Defensive: a non-Date or NaN expiry is skipped (returns null), never crashes
 * the feed. The countdown is relative to now; when already past expiry we say so plainly.
 */
function expiryLine(parkedAt: Date | undefined, expiresAt: Date | undefined): string | null {
  const expiryMs = expiresAt instanceof Date ? expiresAt.getTime() : NaN;
  if (!Number.isFinite(expiryMs)) return null;
  const day = expiresAt!.toISOString().slice(0, 10);
  const hoursLeft = (expiryMs - Date.now()) / MS_PER_HOUR;
  const countdown =
    hoursLeft <= 0
      ? "past due"
      : hoursLeft < 1
        ? "under 1 hour left"
        : `~${Math.round(hoursLeft)} hours left`;
  const submitted =
    parkedAt instanceof Date && Number.isFinite(parkedAt.getTime())
      ? `, submitted ${parkedAt.toISOString().slice(0, 10)}`
      : "";
  return `Expires ${day} (${countdown})${submitted}`;
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

const publishCard: ParkedApprovalSummarizer = ({ parameters, parkedAt, expiresAt }) => {
  const jobId = str(parameters, "jobId") ?? "a kept creative";
  // durableAssetUrl + accountId are threaded into the work-unit parameters by the
  // publish route (it already resolves both via assertPublishable pre-flight). They let
  // the operator review the creative and confirm the target account without opening Mira.
  const assetUrl = str(parameters, "durableAssetUrl");
  const accountId = str(parameters, "accountId");

  const dataLines: Array<string | string[]> = [
    "Publishes a PAUSED draft to the connected Meta ad account",
    "No spend until you activate it in Meta",
  ];
  if (assetUrl) dataLines.push(`Creative: ${assetUrl}`);
  if (accountId) dataLines.push(`Ad account: ${accountId}`);
  const expiry = expiryLine(parkedAt, expiresAt);
  if (expiry) dataLines.push(expiry);

  return {
    humanSummary: `Mira wants to publish creative ${jobId} to Meta as a paused draft package. It will not spend until you activate it in Meta.`,
    dataLines,
    ...(assetUrl ? { assetHref: assetUrl } : {}),
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

const pauseCard: ParkedApprovalSummarizer = ({ parameters }) => {
  const campaignId = str(parameters, "campaignId") ?? "an active campaign";
  const rationale = str(parameters, "rationale");
  const evidence = obj(parameters, "evidence");
  const clicks = num(evidence, "clicks");
  const conversions = num(evidence, "conversions");
  const days = num(evidence, "days");

  const dataLines: Array<string | string[]> = [];
  if (clicks !== null && conversions !== null && days !== null) {
    dataLines.push(`Evidence: ${clicks} clicks, ${conversions} conversions over ${days} days`);
  }
  dataLines.push("Pauses the campaign on Meta immediately after you approve");
  dataLines.push("Reversible: Resume the campaign in Ads Manager to undo (no learning reset)");

  return {
    humanSummary: rationale
      ? `Riley wants to pause campaign ${campaignId}: ${rationale}`
      : `Riley wants to pause campaign ${campaignId}.`,
    dataLines,
    presentation: { primaryLabel: "Approve pause" },
    riskContract: {
      // A pause stops live delivery on Meta: external + financial spend-state
      // mutation. High risk so the card renders with full confirmation weight;
      // platform-state reversible (resume in Ads Manager), recorded in the line above.
      riskLevel: "high",
      externalEffect: true,
      financialEffect: true,
      clientFacing: false,
      requiresConfirmation: true,
    },
  };
};

const PARKED_INTENT_CARDS: Record<string, ParkedApprovalSummarizer> = {
  "adoptimizer.recommendation.handoff": handoffCard,
  "adoptimizer.campaign.pause": pauseCard,
  "creative.job.publish": publishCard,
};

/** Single summarizer handed to adaptParkedApproval; null falls through to the default card. */
export function summarizeParkedIntent(ctx: ParkedApprovalContext): ParkedApprovalSummary | null {
  const card = PARKED_INTENT_CARDS[ctx.intent];
  return card ? card(ctx) : null;
}
