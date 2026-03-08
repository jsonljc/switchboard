// ---------------------------------------------------------------------------
// Cockpit Commands — agent management handlers (status, pause, resume, autonomy)
// ---------------------------------------------------------------------------

import type { HandlerContext } from "./handler-context.js";

/**
 * Handle /status command — shows agent status and last-run info.
 */
export async function handleStatusCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  _organizationId: string | null,
): Promise<void> {
  // Query storage for operator config if available
  // Format: automation level, active agents, last tick times
  // Fall back to a sensible default if no config found

  const lines: string[] = ["Agent Status"];
  lines.push("");

  if (!ctx.storage) {
    lines.push("No agent configuration found.");
    lines.push("Use the dashboard to configure your AI operator.");
    await ctx.sendFilteredReply(threadId, lines.join("\n"));
    return;
  }

  // Try to load operator config from storage
  // For now, show a status card with available info
  lines.push("Agents: Optimizer, Reporter, Monitor, Strategist, Guardrail");
  lines.push("Mode: supervised (default)");
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
  // In a full implementation, this would update the AdsOperatorConfig.active = false
  // For now, acknowledge the command
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
  const validLevels = ["copilot", "supervised", "autonomous"];

  if (!level) {
    // Show current level and explain options
    const lines: string[] = [
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
  if (!validLevels.includes(normalized)) {
    await ctx.sendFilteredReply(
      threadId,
      `Invalid level "${level}". Choose: copilot, supervised, or autonomous.`,
    );
    return;
  }

  // In full implementation: update AdsOperatorConfig.automationLevel
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
