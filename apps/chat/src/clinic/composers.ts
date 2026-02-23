import { AllowedIntent } from "./types.js";

interface CampaignData {
  id?: string;
  name?: string;
  status?: string;
  campaignStatus?: string;
  dailyBudget?: number;
  currentBudget?: number;
  lifetimeBudget?: number | null;
  deliveryStatus?: string;
  startTime?: string;
  endTime?: string | null;
  objective?: string;
}

function toCampaignList(data: unknown): CampaignData[] {
  if (Array.isArray(data)) return data as CampaignData[];
  if (data && typeof data === "object") return [data as CampaignData];
  return [];
}

function formatBudget(cents: number | undefined): string {
  if (cents === undefined || cents === null) return "N/A";
  return `$${(cents / 100).toFixed(2)}`;
}

function statusEmoji(status: string | undefined): string {
  switch (status?.toUpperCase()) {
    case "ACTIVE":
      return "Active";
    case "PAUSED":
      return "Paused";
    case "LEARNING":
      return "Learning";
    case "DELETED":
      return "Deleted";
    case "ARCHIVED":
      return "Archived";
    default:
      return status ?? "Unknown";
  }
}

export function composePerformanceReport(data: unknown): string {
  const campaigns = toCampaignList(data);

  if (campaigns.length === 0) {
    return "No campaigns found for your account.";
  }

  let report = "Campaign Performance Report\n\n";

  for (const c of campaigns) {
    const budget = c.dailyBudget ?? (c.currentBudget ? c.currentBudget * 100 : undefined);
    report += `${c.name ?? "Unknown Campaign"}\n`;
    report += `  Status: ${statusEmoji(c.campaignStatus ?? c.status)}\n`;
    report += `  Daily Budget: ${formatBudget(budget)}\n`;
    report += `  Delivery: ${c.deliveryStatus ?? "Unknown"}\n`;
    report += `  Objective: ${c.objective ?? "Unknown"}\n`;
    report += "\n";
  }

  const activeCount = campaigns.filter(
    (c) => (c.campaignStatus ?? c.status)?.toUpperCase() === "ACTIVE",
  ).length;
  const pausedCount = campaigns.filter(
    (c) => (c.campaignStatus ?? c.status)?.toUpperCase() === "PAUSED",
  ).length;

  report += `Summary: ${activeCount} active, ${pausedCount} paused, ${campaigns.length} total\n`;
  report += "\nReply with a campaign name to see details, or ask me to make changes.";

  return report;
}

export function composeCampaignStatus(data: unknown): string {
  const campaigns = toCampaignList(data);

  if (campaigns.length === 0) {
    return "Campaign not found. Try asking \"how are my campaigns doing?\" to see all campaigns.";
  }

  const c = campaigns[0]!;
  const budget = c.dailyBudget ?? (c.currentBudget ? c.currentBudget * 100 : undefined);

  let card = `Campaign: ${c.name ?? "Unknown"}\n\n`;
  card += `Status: ${statusEmoji(c.campaignStatus ?? c.status)}\n`;
  card += `Daily Budget: ${formatBudget(budget)}\n`;
  card += `Delivery: ${c.deliveryStatus ?? "Unknown"}\n`;
  card += `Objective: ${c.objective ?? "Unknown"}\n`;

  if (c.startTime) {
    card += `Started: ${new Date(c.startTime).toLocaleDateString()}\n`;
  }
  if (c.endTime) {
    card += `Ends: ${new Date(c.endTime).toLocaleDateString()}\n`;
  }

  return card;
}

export function composeRecommendations(intent: AllowedIntent, data: unknown): string {
  const campaigns = toCampaignList(data);

  if (campaigns.length === 0) {
    return "No campaigns found to analyze.";
  }

  const sorted = [...campaigns].sort((a, b) => {
    const budgetA = a.dailyBudget ?? 0;
    const budgetB = b.dailyBudget ?? 0;
    return budgetB - budgetA;
  });

  const activeCampaigns = sorted.filter(
    (c) => (c.campaignStatus ?? c.status)?.toUpperCase() === "ACTIVE",
  );

  if (activeCampaigns.length === 0) {
    return "No active campaigns found. Consider resuming a paused campaign first.";
  }

  if (intent === AllowedIntent.MORE_LEADS) {
    let text = "Recommendations for More Leads\n\n";

    // Recommend increasing budget on best performers (highest budget = proxy for best in mock data)
    const topCampaign = activeCampaigns[0]!;
    const budget = topCampaign.dailyBudget ?? 0;
    const suggestedBudget = Math.round(budget * 1.2);

    text += `1. Increase budget on "${topCampaign.name}"\n`;
    text += `   Current: ${formatBudget(budget)} → Suggested: ${formatBudget(suggestedBudget)}/day\n`;
    text += `   This is your highest-budget campaign.\n\n`;

    if (activeCampaigns.length > 1) {
      const lowCampaign = activeCampaigns[activeCampaigns.length - 1]!;
      if ((lowCampaign.deliveryStatus ?? "").toUpperCase() === "LEARNING") {
        text += `2. Wait on "${lowCampaign.name}" (currently in LEARNING phase)\n`;
        text += `   Changes during learning can reset optimization.\n\n`;
      } else {
        text += `2. Consider increasing "${lowCampaign.name}" budget\n`;
        text += `   Current: ${formatBudget(lowCampaign.dailyBudget ?? 0)}/day\n\n`;
      }
    }

    text += "Reply with a number to apply, or tell me what you'd like to do.";
    return text;
  }

  if (intent === AllowedIntent.REDUCE_COST) {
    let text = "Recommendations to Reduce Cost\n\n";

    // Recommend pausing or reducing budget on lowest performers
    const lowCampaign = activeCampaigns[activeCampaigns.length - 1]!;
    const budget = lowCampaign.dailyBudget ?? 0;
    const reducedBudget = Math.round(budget * 0.75);

    text += `1. Reduce budget on "${lowCampaign.name}"\n`;
    text += `   Current: ${formatBudget(budget)} → Suggested: ${formatBudget(reducedBudget)}/day (-25%)\n\n`;

    if (activeCampaigns.length > 1) {
      text += `2. Pause "${lowCampaign.name}" entirely\n`;
      text += `   Saves ${formatBudget(budget)}/day. You can resume anytime.\n\n`;
    }

    text += "Reply with a number to apply, or tell me what you'd like to do.";
    return text;
  }

  return "I can help you optimize your campaigns. Try asking for \"more leads\" or \"reduce cost\".";
}

export function composeClinicHelp(): string {
  return (
    "I'm your clinic ad assistant. Here's what I can do:\n\n" +
    "Reports\n" +
    "  \"How are my campaigns doing?\"\n" +
    "  \"What's the status of [campaign]?\"\n\n" +
    "Optimize\n" +
    "  \"I want more patient leads\"\n" +
    "  \"Reduce my ad costs\"\n\n" +
    "Actions\n" +
    "  \"Pause [campaign name]\"\n" +
    "  \"Resume [campaign name]\"\n" +
    "  \"Set budget for [campaign] to $[amount]\"\n" +
    "  \"Undo\" (reverts last action)\n\n" +
    "Just type what you need in plain English."
  );
}
