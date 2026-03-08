// ---------------------------------------------------------------------------
// Cockpit Commands — agent management handlers (status, pause, resume, autonomy)
// ---------------------------------------------------------------------------

import type { HandlerContext } from "./handler-context.js";

/**
 * Handle /status command — shows current operator state and available commands.
 */
export async function handleStatusCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  _organizationId: string | null,
): Promise<void> {
  const { active, automationLevel } = ctx.operatorState;

  const lines: string[] = ["Agent Status"];
  lines.push("");
  lines.push(`Status: ${active ? "Active" : "Paused"}`);
  lines.push(`Automation: ${automationLevel}`);
  lines.push("Agents: Optimizer, Reporter, Monitor, Strategist, Guardrail");
  lines.push("");
  lines.push("Commands:");
  lines.push("/pause — Pause all agents");
  lines.push("/resume — Resume agents");
  lines.push("/autonomy [copilot|supervised|autonomous] — Set automation level");

  await ctx.sendFilteredReply(threadId, lines.join("\n"));
}

/**
 * Handle /pause command — pauses agent operations.
 */
export async function handlePauseCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
): Promise<void> {
  if (!ctx.operatorState.active) {
    await ctx.sendFilteredReply(threadId, "Agents are already paused.\n\nUse /resume to restart.");
    return;
  }

  ctx.operatorState.active = false;

  await ctx.sendFilteredReply(
    threadId,
    "Agent operations paused. All scheduled optimization and monitoring is suspended.\n\nUse /resume to restart.",
  );
}

/**
 * Handle /resume command — resumes paused agent operations.
 */
export async function handleResumeCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
): Promise<void> {
  if (ctx.operatorState.active) {
    await ctx.sendFilteredReply(threadId, "Agents are already running.");
    return;
  }

  ctx.operatorState.active = true;

  await ctx.sendFilteredReply(
    threadId,
    "Agent operations resumed. Optimizer and Monitor will run on schedule.",
  );
}

/**
 * Handle /autonomy command — shows or sets automation level.
 */
export async function handleAutonomyCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  level?: string,
): Promise<void> {
  const validLevels = ["copilot", "supervised", "autonomous"] as const;

  if (!level) {
    const { automationLevel } = ctx.operatorState;
    const lines: string[] = [
      `Current level: ${automationLevel}`,
      "",
      "Automation Levels:",
      "",
      "copilot — All actions require your approval",
      "supervised — Low-risk actions auto-execute, others need approval",
      "autonomous — All actions within risk tolerance auto-execute",
      "",
      "Usage: /autonomy <level>",
      "Example: /autonomy supervised",
    ];
    await ctx.sendFilteredReply(threadId, lines.join("\n"));
    return;
  }

  const normalized = level.trim().toLowerCase();
  if (!validLevels.includes(normalized as (typeof validLevels)[number])) {
    await ctx.sendFilteredReply(
      threadId,
      `Invalid level "${level}". Choose: copilot, supervised, or autonomous.`,
    );
    return;
  }

  ctx.operatorState.automationLevel = normalized as (typeof validLevels)[number];

  const descriptions: Record<string, string> = {
    copilot: "All actions will require your approval via Telegram.",
    supervised:
      "Low-risk optimizations will auto-execute. Medium and high-risk actions need your approval.",
    autonomous:
      "All actions within risk tolerance will auto-execute. Weekly summary reports will be sent.",
  };

  await ctx.sendFilteredReply(
    threadId,
    `Automation level set to: ${normalized}\n\n${descriptions[normalized]}`,
  );
}
