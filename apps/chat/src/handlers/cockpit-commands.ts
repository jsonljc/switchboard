// ---------------------------------------------------------------------------
// Cockpit Commands — agent management handlers (status, pause, resume, autonomy)
// ---------------------------------------------------------------------------
// These commands are intercepted before the LLM interpreter so they execute
// deterministically. When SWITCHBOARD_API_URL is configured, changes are
// persisted to the API server (which the agent-runner reads each cycle).
// ---------------------------------------------------------------------------

import type { HandlerContext } from "./handler-context.js";

/**
 * Persist an operator config update via the API server.
 * Falls back silently if apiBaseUrl is not set (dev mode).
 */
async function persistConfigUpdate(
  ctx: HandlerContext,
  organizationId: string | null,
  updates: Record<string, unknown>,
): Promise<boolean> {
  if (!ctx.apiBaseUrl || !organizationId) return false;

  try {
    const res = await fetch(`${ctx.apiBaseUrl}/api/operator-config/${organizationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Handle /status command — shows current operator state and available commands.
 */
export async function handleStatusCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  organizationId: string | null,
): Promise<void> {
  const { active, automationLevel } = ctx.operatorState;

  // Try to fetch live config from API if available
  if (ctx.apiBaseUrl && organizationId) {
    try {
      const res = await fetch(`${ctx.apiBaseUrl}/api/operator-config/${organizationId}`);
      if (res.ok) {
        const data = (await res.json()) as {
          config?: { active?: boolean; automationLevel?: string };
        };
        if (data.config) {
          ctx.operatorState.active = data.config.active ?? active;
          ctx.operatorState.automationLevel =
            (data.config.automationLevel as typeof automationLevel) ?? automationLevel;
        }
      }
    } catch {
      // Use in-memory state as fallback
    }
  }

  const lines: string[] = ["Agent Status"];
  lines.push("");
  lines.push(`Status: ${ctx.operatorState.active ? "Active" : "Paused"}`);
  lines.push(`Automation: ${ctx.operatorState.automationLevel}`);
  lines.push("Agents: Optimizer, Reporter, Monitor, Strategist, Guardrail");
  lines.push("");
  lines.push("Commands:");
  lines.push("/pause — Pause all agents");
  lines.push("/resume — Resume agents");
  lines.push("/autonomy [copilot|supervised|autonomous] — Set automation level");
  lines.push("/autonomy-status — View autonomy progression and competence stats");

  await ctx.sendFilteredReply(threadId, lines.join("\n"));
}

/**
 * Handle /pause command — pauses agent operations.
 */
export async function handlePauseCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  organizationId: string | null,
): Promise<void> {
  if (!ctx.operatorState.active) {
    await ctx.sendFilteredReply(threadId, "Agents are already paused.\n\nUse /resume to restart.");
    return;
  }

  ctx.operatorState.active = false;
  await persistConfigUpdate(ctx, organizationId, { active: false });

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
  organizationId: string | null,
): Promise<void> {
  if (ctx.operatorState.active) {
    await ctx.sendFilteredReply(threadId, "Agents are already running.");
    return;
  }

  ctx.operatorState.active = true;
  await persistConfigUpdate(ctx, organizationId, { active: true });

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
  organizationId: string | null,
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

  const newLevel = normalized as (typeof validLevels)[number];
  ctx.operatorState.automationLevel = newLevel;
  await persistConfigUpdate(ctx, organizationId, { automationLevel: newLevel });

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

/**
 * Handle /autonomy-status command — shows progressive autonomy assessment.
 */
export async function handleAutonomyStatusCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  organizationId: string | null,
): Promise<void> {
  if (!ctx.apiBaseUrl || !organizationId) {
    await ctx.sendFilteredReply(
      threadId,
      `Current level: ${ctx.operatorState.automationLevel}\n\nAutonomy assessment requires API connection. Progress data is not available in dev mode.`,
    );
    return;
  }

  try {
    const res = await fetch(`${ctx.apiBaseUrl}/api/operator-config/${organizationId}/autonomy`);

    if (!res.ok) {
      await ctx.sendFilteredReply(
        threadId,
        `Current level: ${ctx.operatorState.automationLevel}\n\nCould not fetch autonomy assessment. The API returned status ${res.status}.`,
      );
      return;
    }

    const data = (await res.json()) as {
      assessment?: {
        currentProfile: string;
        recommendedProfile: string;
        autonomousEligible: boolean;
        reason: string;
        progressPercent: number;
        stats: {
          totalSuccesses: number;
          totalFailures: number;
          competenceScore: number;
          failureRate: number;
        };
      };
    };

    if (!data.assessment) {
      await ctx.sendFilteredReply(threadId, "No assessment data available.");
      return;
    }

    const a = data.assessment;
    const lines: string[] = ["Autonomy Assessment"];
    lines.push("");
    lines.push(`Profile: ${a.currentProfile}`);

    if (a.recommendedProfile !== a.currentProfile) {
      lines.push(`Upgrade available: ${a.currentProfile} -> ${a.recommendedProfile}`);
    }

    if (a.autonomousEligible) {
      lines.push("Autonomous mode: Eligible");
    }

    lines.push("");
    lines.push(`Progress: ${a.progressPercent}%`);
    const progressBar =
      "[" +
      "#".repeat(Math.round(a.progressPercent / 5)) +
      "-".repeat(20 - Math.round(a.progressPercent / 5)) +
      "]";
    lines.push(progressBar);
    lines.push("");
    lines.push(`Score: ${a.stats.competenceScore.toFixed(0)}`);
    lines.push(
      `Track record: ${a.stats.totalSuccesses} successes, ${a.stats.totalFailures} failures (${(a.stats.failureRate * 100).toFixed(0)}% failure rate)`,
    );
    lines.push("");
    lines.push(a.reason);

    await ctx.sendFilteredReply(threadId, lines.join("\n"));
  } catch {
    await ctx.sendFilteredReply(
      threadId,
      `Current level: ${ctx.operatorState.automationLevel}\n\nCould not reach the API server for autonomy assessment.`,
    );
  }
}
