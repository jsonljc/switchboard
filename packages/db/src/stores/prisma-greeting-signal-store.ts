// ---------------------------------------------------------------------------
// PrismaGreetingSignalStore — Queries PendingActionRecord + AuditEntry
//
// Implements core's GreetingSignalStore interface.
// Computes inbox counts, oldest item age, last operator action timestamp.
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";
import type { AgentKey } from "@switchboard/schemas";
import type { agentHome } from "@switchboard/core";

export class PrismaGreetingSignalStore implements agentHome.GreetingSignalStore {
  constructor(private prisma: PrismaClient) {}

  async getSignal(orgId: string, agentKey: AgentKey): Promise<agentHome.GreetingSignal> {
    // Three parallel queries
    const [inboxCount, oldestRecord, lastOperatorAction] = await Promise.all([
      // 1. Count pending records for this agent
      this.prisma.pendingActionRecord.count({
        where: {
          organizationId: orgId,
          sourceAgent: agentKey,
          status: "pending",
          surface: "queue",
        },
      }),

      // 2. Find oldest pending record for age calculation
      this.prisma.pendingActionRecord.findFirst({
        where: {
          organizationId: orgId,
          sourceAgent: agentKey,
          status: "pending",
          surface: "queue",
        },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),

      // 3. Find most recent operator action
      this.prisma.auditEntry.findFirst({
        where: {
          organizationId: orgId,
          actorType: "operator",
        },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      }),
    ]);

    const now = Date.now();

    const oldestOpenItemAgeHours = oldestRecord
      ? (now - oldestRecord.createdAt.getTime()) / (1000 * 60 * 60)
      : null;

    const hoursSinceLastOperatorAction = lastOperatorAction
      ? (now - lastOperatorAction.timestamp.getTime()) / (1000 * 60 * 60)
      : null;

    return {
      inboxCount,
      oldestOpenItemAgeHours,
      hoursSinceLastOperatorAction,
    };
  }

  async getTopItem(orgId: string, agentKey: AgentKey): Promise<agentHome.TopItemMeta | null> {
    const oldestRecord = await this.prisma.pendingActionRecord.findFirst({
      where: {
        organizationId: orgId,
        sourceAgent: agentKey,
        status: "pending",
        surface: "queue",
      },
      orderBy: { createdAt: "asc" },
      select: { humanSummary: true, createdAt: true },
    });

    if (!oldestRecord) return null;

    const name = extractName(oldestRecord.humanSummary);
    if (!name) return null;

    const ageHours = (Date.now() - oldestRecord.createdAt.getTime()) / (1000 * 60 * 60);
    const ageLabel = formatAgeLabel(ageHours);

    return { name, ageLabel };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Name Extraction Heuristic
// ──────────────────────────────────────────────────────────────────────────

const SKIP_WORDS = new Set([
  "Pause",
  "Resume",
  "Stop",
  "Start",
  "Create",
  "Update",
  "Delete",
  "Review",
  "Approve",
  "Reject",
  "Send",
  "Cancel",
  "Adjust",
  "Book",
  "New",
  "The",
  "This",
  "That",
  "A",
  "An",
  "For",
  "With",
  "From",
  "And",
  "But",
  "Or",
  "No",
  "Not",
  "All",
  "Set",
  "Get",
  "Is",
  "Are",
]);

function extractName(humanSummary: string): string | null {
  const quotedMatch = humanSummary.match(/"([^"]+)"/);
  if (quotedMatch && quotedMatch[1]) return quotedMatch[1];

  const words = humanSummary.split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z]/g, "");
    if (clean.length >= 2 && /^[A-Z]/.test(clean) && !SKIP_WORDS.has(clean)) {
      return clean;
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Age Label Formatter
// ──────────────────────────────────────────────────────────────────────────

function formatAgeLabel(hours: number): string {
  if (hours < 1) return "less than an hour";
  if (hours < 1.5) return "about an hour";
  if (hours < 24) return `${Math.floor(hours)} hours`;
  if (hours < 36) return "a day";

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days`;
  if (days < 10) return "a week";

  const weeks = Math.floor(days / 7);
  return `${weeks} weeks`;
}
