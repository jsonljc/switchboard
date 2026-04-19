// ---------------------------------------------------------------------------
// /sold command — record revenue via chat
// ---------------------------------------------------------------------------

import type { HandlerContext } from "./handler-context.js";

export interface PendingSale {
  contactId: string | null;
  contactName: string | null;
  amount: number;
  description: string;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  createdAt: number;
}

const EXPIRY_MS = 5 * 60 * 1000;
const pendingSales = new Map<string, PendingSale>();

export function parseSoldInput(
  input: string,
): { name: string | null; amount: number; description: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(?:([A-Za-z][\w\s]*?)\s+)?(?:\$?)(\d+(?:\.\d{1,2})?)\s*(.*)$/);
  if (!match) return null;

  const name = match[1]?.trim() ?? null;
  const amount = parseFloat(match[2]!);
  const description = match[3]?.trim() ?? "";

  if (isNaN(amount) || amount <= 0) return null;

  return { name, amount, description };
}

export function setPendingSale(threadId: string, sale: PendingSale): void {
  pendingSales.set(threadId, sale);
}

export function checkPendingSale(threadId: string): PendingSale | null {
  const sale = pendingSales.get(threadId);
  if (!sale) return null;

  if (Date.now() - sale.createdAt > EXPIRY_MS) {
    pendingSales.delete(threadId);
    return null;
  }

  return sale;
}

export function clearPendingSale(threadId: string): void {
  pendingSales.delete(threadId);
}

export async function handleSoldCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  organizationId: string | null,
  input: string,
): Promise<void> {
  if (!organizationId) {
    await ctx.sendFilteredReply(threadId, "Cannot record revenue: no organization context.");
    return;
  }

  const parsed = parseSoldInput(input);
  if (!parsed) {
    await ctx.sendFilteredReply(
      threadId,
      "Usage: /sold [name] amount [description]\nExample: /sold Sarah 388 Pico Laser",
    );
    return;
  }

  const parts = [`Record $${parsed.amount}`];
  if (parsed.name) parts.push(`from ${parsed.name}`);
  if (parsed.description) parts.push(`for ${parsed.description}`);
  parts.push("?\n\nReply Y to confirm.");

  setPendingSale(threadId, {
    contactId: null,
    contactName: parsed.name,
    amount: parsed.amount,
    description: parsed.description,
    sourceCampaignId: null,
    sourceAdId: null,
    createdAt: Date.now(),
  });

  await ctx.sendFilteredReply(threadId, parts.join(" "));
}

export async function handleSoldConfirmation(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  organizationId: string | null,
  reply: string,
): Promise<boolean> {
  const sale = checkPendingSale(threadId);
  if (!sale) return false;

  clearPendingSale(threadId);

  const isYes = /^y(es)?$/i.test(reply.trim());
  if (!isYes) {
    await ctx.sendFilteredReply(threadId, "Sale recording cancelled.");
    return true;
  }

  if (!organizationId || !ctx.apiBaseUrl) {
    await ctx.sendFilteredReply(threadId, "Cannot record: no API connection.");
    return true;
  }

  try {
    const res = await fetch(`${ctx.apiBaseUrl}/api/${organizationId}/revenue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: sale.contactId ?? "unknown",
        amount: sale.amount,
        recordedBy: "owner",
      }),
    });

    if (!res.ok) {
      await ctx.sendFilteredReply(threadId, "Failed to record sale. Please try again.");
      return true;
    }

    const displayName = sale.contactName ?? "unknown contact";
    const desc = sale.description ? ` for ${sale.description}` : "";
    await ctx.sendFilteredReply(
      threadId,
      `Recorded: $${sale.amount} from ${displayName}${desc}. Meta has been notified.`,
    );
  } catch {
    await ctx.sendFilteredReply(threadId, "Failed to record sale. Please try again.");
  }

  return true;
}
