// ---------------------------------------------------------------------------
// PrismaGreetingSignalStore — Queries PendingActionRecord + AuditEntry
//
// Implements core's GreetingSignalStore interface.
// Computes inbox counts, oldest item age, last operator action timestamp.
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";
import type { AgentKey } from "@switchboard/schemas";
import type { agentHome, MiraCreativeJobSummary } from "@switchboard/core";
import { PrismaMiraCreativeReadModelReader } from "./prisma-mira-creative-read-model-reader.js";

// Greeting window timezone for the Mira read-model. M1 uses "UTC" here: greeting
// age thresholds are coarse (busyAgeHoursThreshold buckets), so a per-org tz is
// not threaded into this signal path. Acceptable for M1; revisit if greeting copy
// becomes tz-sensitive.
const MIRA_GREETING_TIMEZONE = "UTC";
// Pass a high visible limit so the read-model does not slice away awaiting-review
// jobs before we scan for the oldest (counts already cover the full window).
const MIRA_GREETING_VISIBLE_LIMIT = 200;

export class PrismaGreetingSignalStore implements agentHome.GreetingSignalStore {
  constructor(private prisma: PrismaClient) {}

  async getSignal(orgId: string, agentKey: AgentKey): Promise<agentHome.GreetingSignal> {
    if (agentKey === "mira") {
      return this.getMiraSignal(orgId);
    }

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

  // Mira greeting signal, derived from the creative read-model seam (not
  // PendingActionRecord — Mira has no pending-action rows). inboxCount maps to
  // awaiting-review drafts; oldestOpenItemAgeHours comes from the oldest
  // awaiting-review job. Operator-action recency stays org-scoped (agent-agnostic).
  private async getMiraSignal(orgId: string): Promise<agentHome.GreetingSignal> {
    const now = Date.now();
    const [readModel, lastOperatorAction] = await Promise.all([
      new PrismaMiraCreativeReadModelReader(this.prisma).read(orgId, {
        now: new Date(now),
        timezone: MIRA_GREETING_TIMEZONE,
        visibleLimit: MIRA_GREETING_VISIBLE_LIMIT,
      }),
      this.prisma.auditEntry.findFirst({
        where: { organizationId: orgId, actorType: "operator" },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      }),
    ]);

    const oldest = oldestAwaitingReview(readModel.jobs);
    const oldestOpenItemAgeHours = oldest
      ? (now - new Date(oldest.createdAt).getTime()) / (1000 * 60 * 60)
      : null;
    const hoursSinceLastOperatorAction = lastOperatorAction
      ? (now - lastOperatorAction.timestamp.getTime()) / (1000 * 60 * 60)
      : null;

    return {
      inboxCount: readModel.counts.awaitingReview,
      oldestOpenItemAgeHours,
      hoursSinceLastOperatorAction,
    };
  }

  async getTopItem(orgId: string, agentKey: AgentKey): Promise<agentHome.TopItemMeta | null> {
    if (agentKey === "mira") {
      return this.getMiraTopItem(orgId);
    }

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

  // Mira top item = the oldest awaiting-review draft; its title is the name.
  private async getMiraTopItem(orgId: string): Promise<agentHome.TopItemMeta | null> {
    const now = Date.now();
    const readModel = await new PrismaMiraCreativeReadModelReader(this.prisma).read(orgId, {
      now: new Date(now),
      timezone: MIRA_GREETING_TIMEZONE,
      visibleLimit: MIRA_GREETING_VISIBLE_LIMIT,
    });
    const oldest = oldestAwaitingReview(readModel.jobs);
    if (!oldest) return null;
    const ageHours = (now - new Date(oldest.createdAt).getTime()) / (1000 * 60 * 60);
    return { name: oldest.title, ageLabel: formatAgeLabel(ageHours) };
  }
}

// Oldest (earliest createdAt) awaiting-review job in the read-model window, or
// null when none are awaiting review.
function oldestAwaitingReview(
  jobs: readonly MiraCreativeJobSummary[],
): MiraCreativeJobSummary | null {
  let oldest: MiraCreativeJobSummary | null = null;
  for (const job of jobs) {
    if (job.status !== "awaiting_review") continue;
    if (
      oldest === null ||
      new Date(job.createdAt).getTime() < new Date(oldest.createdAt).getTime()
    ) {
      oldest = job;
    }
  }
  return oldest;
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
