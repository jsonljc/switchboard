import type { DecisionTrace } from "@switchboard/schemas";
import type { ResolvedSkin } from "@switchboard/core";

export function composeDenialReply(trace: DecisionTrace): string {
  const deniedCheck = trace.checks.find((c) => c.matched && c.effect === "deny");

  let reply = `Blocked: ${trace.explanation}\n\n`;

  if (deniedCheck) {
    reply += `Why: ${deniedCheck.humanDetail}\n`;
    reply += `Check: ${deniedCheck.checkCode}\n`;
  }

  return reply;
}

export function composeHelpMessage(
  availableActions: string[],
  terminology?: Record<string, string>,
): string {
  const sections: string[] = [];
  const t = (label: string): string => {
    if (!terminology) return label;
    // Apply terminology to category names
    let result = label;
    for (const [from, to] of Object.entries(terminology)) {
      const pattern = new RegExp(`\\b${from}\\b`, "gi");
      result = result.replace(pattern, to);
    }
    return result;
  };

  const hasAds = availableActions.some((a) => a.startsWith("digital-ads."));
  const hasPayments = availableActions.some((a) => a.startsWith("payments."));
  const hasTrading = availableActions.some((a) => a.startsWith("trading."));

  if (hasAds) {
    sections.push(
      `${t("Campaign Management")}\n` +
        `  \u2022 Pause or resume a campaign\n` +
        `  \u2022 Change a campaign's budget`,
    );
    sections.push(
      `Performance\n` +
        `  \u2022 "How are my ads doing?"\n` +
        `  \u2022 "Diagnose my funnel"\n` +
        `  \u2022 "Show me my metrics"`,
    );
  }
  if (hasPayments) {
    sections.push(
      `Payments\n` +
        `  \u2022 Process a refund\n` +
        `  \u2022 Charge a customer\n` +
        `  \u2022 Send an invoice\n` +
        `  \u2022 Cancel a subscription\n` +
        `  \u2022 Apply a credit\n` +
        `  \u2022 Create a payment link`,
    );
  }
  if (hasTrading) {
    sections.push(
      `Trading\n` + `  \u2022 Place a market or limit order\n` + `  \u2022 Cancel an order`,
    );
  }

  return (
    `Here's what I can help with:\n\n` + sections.join("\n\n") + `\n\nJust type what you need!`
  );
}

export function composeUncertainReply(availableActions?: string[]): string {
  const capabilities: string[] = [];
  if (!availableActions || availableActions.length === 0) {
    capabilities.push("various actions");
  } else {
    if (availableActions.some((a) => a.startsWith("digital-ads."))) {
      capabilities.push("pause/resume campaigns, adjust budgets, diagnostics");
    }
    if (availableActions.some((a) => a.startsWith("payments."))) {
      capabilities.push("refunds, charges, invoices, subscriptions");
    }
    if (availableActions.some((a) => a.startsWith("trading."))) {
      capabilities.push("market/limit orders, position management");
    }
    if (capabilities.length === 0) {
      capabilities.push("various actions");
    }
  }
  return (
    "I didn't quite catch that. Could you rephrase?\n" +
    `I can help with: ${capabilities.join("; ")}.\n` +
    "Type 'help' to see what I can do."
  );
}

export function composeWelcomeMessage(
  resolvedSkin: ResolvedSkin | null,
  businessName?: string,
  availableActions?: string[],
): string {
  const welcomeTemplate = resolvedSkin?.language?.welcomeMessage;

  if (welcomeTemplate) {
    const name = businessName || resolvedSkin?.manifest?.name || "our team";
    return welcomeTemplate.replace(/\{\{businessName\}\}/g, name);
  }

  // Default welcome when no skin template is configured
  const capabilities: string[] = [];
  if (availableActions && availableActions.length > 0) {
    if (availableActions.some((a) => a.startsWith("digital-ads."))) {
      capabilities.push("manage campaigns and view performance");
    }
    if (availableActions.some((a) => a.startsWith("payments."))) {
      capabilities.push("process payments and manage subscriptions");
    }
    if (availableActions.some((a) => a.startsWith("trading."))) {
      capabilities.push("place and manage orders");
    }
    if (availableActions.some((a) => a.startsWith("customer-engagement."))) {
      capabilities.push("manage appointments, reminders, and contacts");
    }
  }

  const greeting = businessName ? `Welcome to ${businessName}!` : "Welcome!";
  const capabilityText =
    capabilities.length > 0 ? ` I can help you ${capabilities.join(", ")}.` : " I'm here to help.";

  return `${greeting}${capabilityText}\n\nType 'help' to see everything I can do, or just tell me what you need!`;
}
