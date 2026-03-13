import { AllowedIntent } from "./types.js";
import { detectPromptInjection } from "../interpreter/injection-detector.js";

/** Maps write intents to cartridge action types. */
export const INTENT_TO_ACTION: Record<string, string> = {
  [AllowedIntent.PAUSE]: "digital-ads.campaign.pause",
  [AllowedIntent.RESUME]: "digital-ads.campaign.resume",
  [AllowedIntent.ADJUST_BUDGET]: "digital-ads.campaign.adjust_budget",
};

/** All valid intent values for validation. */
export const VALID_INTENTS = new Set(Object.values(AllowedIntent));

const MAX_CAMPAIGN_NAME_LENGTH = 80;

/** Sanitize a campaign name before injecting into the LLM system prompt. */
export function sanitizeCampaignName(name: string): string {
  return name
    .replace(/[\r\n]/g, " ") // Strip newlines (prevent prompt structure escape)
    .replace(/[<>]/g, "") // Strip angle brackets (prevent XML-like tag injection)
    .replace(/\{[A-Z_]+\}/g, "") // Strip placeholder-like patterns
    .slice(0, MAX_CAMPAIGN_NAME_LENGTH)
    .trim();
}

/** Regex fallback patterns (subset of RuleBasedInterpreter). */
export const FALLBACK_PATTERNS: Array<{
  regex: RegExp;
  intent: AllowedIntent;
  extractSlots: (match: RegExpMatchArray) => Record<string, unknown>;
}> = [
  {
    regex: /pause\s+(?:campaign\s+)?['"]?(.+?)['"]?\s*$/i,
    intent: AllowedIntent.PAUSE,
    extractSlots: (m) => ({ campaignRef: m[1]?.trim() }),
  },
  {
    regex: /resume\s+(?:campaign\s+)?['"]?(.+?)['"]?\s*$/i,
    intent: AllowedIntent.RESUME,
    extractSlots: (m) => ({ campaignRef: m[1]?.trim() }),
  },
  {
    regex:
      /(?:set|change|adjust)\s+(?:the\s+)?budget\s+(?:for\s+)?['"]?(.+?)['"]?\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/i,
    intent: AllowedIntent.ADJUST_BUDGET,
    extractSlots: (m) => ({ campaignRef: m[1]?.trim(), newBudget: parseFloat(m[2] ?? "0") }),
  },
  {
    regex: /how\s+(?:are|is)\s+(?:my\s+)?(?:campaigns?|ads?|performance)/i,
    intent: AllowedIntent.REPORT_PERFORMANCE,
    extractSlots: () => ({}),
  },
  {
    regex: /(?:status|check)\s+(?:of\s+)?(?:my\s+)?(?:campaigns?|ads?)/i,
    intent: AllowedIntent.CHECK_STATUS,
    extractSlots: () => ({}),
  },
  {
    regex: /more\s+(?:patient\s+)?leads/i,
    intent: AllowedIntent.MORE_LEADS,
    extractSlots: () => ({}),
  },
  {
    regex: /(?:reduce|lower|cut)\s+(?:my\s+)?(?:ad\s+)?(?:cost|spend|cpl)/i,
    intent: AllowedIntent.REDUCE_COST,
    extractSlots: () => ({}),
  },
  {
    regex: /^undo$/i,
    intent: AllowedIntent.REVERT,
    extractSlots: () => ({}),
  },
  // Diagnostic fallback patterns
  {
    regex: /diagnose\s+(?:my\s+)?funnel/i,
    intent: AllowedIntent.DIAGNOSE_FUNNEL,
    extractSlots: () => ({}),
  },
  {
    regex:
      /(?:how\s+are|what's\s+wrong\s+with|analyze)\s+(?:my\s+)?(?:ads?|campaigns?|funnel|performance)/i,
    intent: AllowedIntent.DIAGNOSE_FUNNEL,
    extractSlots: () => ({}),
  },
  {
    regex: /(?:portfolio|cross.?platform)\s+(?:analysis|diagnostic|report)/i,
    intent: AllowedIntent.DIAGNOSE_PORTFOLIO,
    extractSlots: () => ({}),
  },
  {
    regex: /(?:snapshot|raw\s+metrics|show\s+(?:me\s+)?(?:my\s+)?metrics)/i,
    intent: AllowedIntent.FETCH_SNAPSHOT,
    extractSlots: () => ({}),
  },
  {
    regex: /(?:campaign|ad\s*set)\s+structure\s+(?:analysis|check|review)/i,
    intent: AllowedIntent.ANALYZE_STRUCTURE,
    extractSlots: () => ({}),
  },
];

export const SYSTEM_PROMPT = `You are a clinic ad operations classifier. Your ONLY job is to classify the user's message into one of these intents and extract relevant parameters.

Important: Your output is a classification that feeds into a governance pipeline. You do not execute actions directly. All write intents are subject to policy evaluation, risk scoring, and approval requirements before any action is taken.

Intents:
- report_performance: user wants to see how campaigns are performing (e.g. "how are my ads doing?", "weekly report")
- more_leads: user wants more patient leads or wants recommendations to improve lead volume
- reduce_cost: user wants to reduce ad spending or cost per lead
- check_status: user wants to know current campaign status (active/paused/learning)
- pause: user wants to pause a specific campaign
- resume: user wants to resume/unpause a specific campaign
- adjust_budget: user wants to change a campaign's budget (increase, decrease, set to specific amount)
- kill_switch: user wants to stop ALL campaigns immediately (emergency)
- revert: user wants to undo the last action
- diagnose_funnel: user wants a diagnostic analysis of their ad funnel (e.g. "diagnose my funnel", "what's wrong with my ads")
- diagnose_portfolio: user wants cross-platform portfolio analysis (e.g. "portfolio analysis", "cross-platform report")
- fetch_snapshot: user wants raw metrics/snapshot data (e.g. "show me my metrics", "snapshot")
- analyze_structure: user wants campaign structure analysis (e.g. "analyze campaign structure", "check ad set structure")
- unknown: the message is not related to ad management

Known campaigns for this clinic:
{CAMPAIGN_NAMES}

Ad account: {AD_ACCOUNT_ID}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "intent": "<one of the intent values above>",
  "confidence": <0.0 to 1.0>,
  "slots": { "campaignRef": "...", "period": "...", "budgetAmount": ... },
  "reasoning": "<brief explanation>"
}

Rules:
- Only use intents from the list above
- Extract campaign names, budget amounts, and time periods into slots
- If the user mentions a specific campaign, put it in slots.campaignRef
- If the user mentions a budget amount, put it in slots.budgetAmount
- If you are unsure, set confidence below 0.5`;

/**
 * Build the full LLM prompt from user text, conversation context, and clinic context.
 */
export function buildClinicPrompt(
  text: string,
  conversationContext: Record<string, unknown>,
  campaignNames: string[] | undefined,
  adAccountId: string,
): string {
  const campaignNamesBlock = campaignNames?.length
    ? campaignNames.map((n) => `- ${sanitizeCampaignName(n)}`).join("\n")
    : "(no campaigns loaded yet)";

  const system = SYSTEM_PROMPT.replace("{CAMPAIGN_NAMES}", campaignNamesBlock).replace(
    "{AD_ACCOUNT_ID}",
    adAccountId,
  );

  // Include recent conversation history for multi-turn context
  const recentMessages = conversationContext["recentMessages"] as
    | Array<{ role: string; text: string }>
    | undefined;

  let historyBlock = "";
  if (recentMessages && recentMessages.length > 1) {
    const priorMessages = recentMessages.slice(0, -1);
    if (priorMessages.length > 0) {
      const formatted = priorMessages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
        .join("\n");
      historyBlock = `\nRecent conversation (resolve references like "it", "that", "the same campaign" using this):\n${formatted}\n`;
    }
  }

  // Structural separation: user text in a clearly delimited block
  return `${system}${historyBlock}\n<user_message>\n${text}\n</user_message>`;
}

/**
 * Filter campaign names: sanitize, detect injection, and return clean list.
 */
export function filterCampaignNames(names: string[]): string[] {
  return names.map(sanitizeCampaignName).filter((name) => {
    if (name.length === 0) return false;
    const check = detectPromptInjection(name);
    if (check.detected) {
      console.warn(
        `[Clinic] Filtered campaign name with injection pattern: "${name}" [${check.patterns.join(", ")}]`,
      );
      return false;
    }
    return true;
  });
}
