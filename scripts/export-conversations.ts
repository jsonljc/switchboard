#!/usr/bin/env npx tsx
/**
 * Export conversations for manual review during Alex wedge validation sprint.
 *
 * Usage:
 *   npx tsx scripts/export-conversations.ts --org org_demo --since 2026-04-17
 *   npx tsx scripts/export-conversations.ts --org org_demo --since 2026-04-17 > conversations.json
 */

import { PrismaClient } from "@switchboard/db";

interface ExportedConversation {
  threadId: string;
  contactId: string;
  organizationId: string;
  stage: string;
  assignedAgent: string;
  agentContext: unknown;
  currentSummary: string;
  messageCount: number;
  threadStatus: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    direction: string;
    content: string;
    channel: string;
    createdAt: Date;
  }>;
}

function parseArgs(): { org: string; since: Date } {
  const args = process.argv.slice(2);
  let org: string | undefined;
  let since: Date | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--org" && i + 1 < args.length) {
      org = args[i + 1];
      i++;
    } else if (args[i] === "--since" && i + 1 < args.length) {
      since = new Date(args[i + 1]);
      i++;
    }
  }

  if (!org) {
    console.error("Error: --org argument is required");
    console.error(
      "Usage: npx tsx scripts/export-conversations.ts --org org_demo --since 2026-04-17",
    );
    process.exit(1);
  }

  if (!since) {
    // Default to 7 days ago
    since = new Date();
    since.setDate(since.getDate() - 7);
  }

  if (isNaN(since.getTime())) {
    console.error("Error: --since must be a valid ISO date string (e.g., 2026-04-17)");
    process.exit(1);
  }

  return { org, since };
}

async function exportConversations() {
  const { org, since } = parseArgs();

  console.error(`Exporting conversations for organization: ${org}`);
  console.error(`Since: ${since.toISOString()}`);

  const prisma = new PrismaClient();

  try {
    // Query conversation threads for the org since the given date
    const threads = await prisma.conversationThread.findMany({
      where: {
        organizationId: org,
        createdAt: {
          gte: since,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    console.error(`Found ${threads.length} conversation threads`);

    // For each thread, fetch all messages
    const conversations: ExportedConversation[] = [];

    for (const thread of threads) {
      const messages = await prisma.conversationMessage.findMany({
        where: {
          contactId: thread.contactId,
          orgId: thread.organizationId,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      conversations.push({
        threadId: thread.id,
        contactId: thread.contactId,
        organizationId: thread.organizationId,
        stage: thread.stage,
        assignedAgent: thread.assignedAgent,
        agentContext: thread.agentContext,
        currentSummary: thread.currentSummary,
        messageCount: thread.messageCount,
        threadStatus: thread.threadStatus,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messages: messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          content: m.content,
          channel: m.channel,
          createdAt: m.createdAt,
        })),
      });
    }

    // Output as formatted JSON to stdout
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(conversations, null, 2));

    console.error(`\nExport complete. ${conversations.length} conversations exported.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Can't reach database server")) {
      console.error(
        "\nError: Cannot connect to database. Make sure DATABASE_URL is set and the database is running.",
      );
      process.exit(1);
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

exportConversations().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
