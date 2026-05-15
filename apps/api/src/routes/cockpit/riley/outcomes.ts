import type { FastifyInstance } from "fastify";
import { renderOutcomeCopy } from "@switchboard/schemas";
import type { ActivityRow } from "@switchboard/schemas";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";

export interface OutcomesRouteDeps {
  listRenderable(args: { orgId: string; limit: number }): Promise<RecommendationOutcomeReadModel[]>;
}

const DEFAULT_LIMIT = 100;

const ACTION_LABEL: Record<string, string> = {
  pause: "pause",
  refresh_creative: "creative refresh",
};

export async function registerRileyOutcomesRoute(
  app: FastifyInstance,
  deps: OutcomesRouteDeps,
): Promise<void> {
  app.get("/api/cockpit/riley/outcomes", async (req, reply) => {
    const orgId = (req.query as { orgId?: string } | undefined)?.orgId;
    if (!orgId) {
      reply.code(400);
      return { error: "orgId query param required" };
    }
    const rows = await deps.listRenderable({ orgId, limit: DEFAULT_LIMIT });
    return { rows: rows.map(translateRow).filter((r): r is ActivityRow => r !== null) };
  });
}

function translateRow(row: RecommendationOutcomeReadModel): ActivityRow | null {
  if (!row.copyTemplate || !row.copyValues) return null;
  const head = renderOutcomeCopy(row.copyTemplate, row.copyValues);
  if (head === null) return null; // fail-closed on off-allowlist template

  const label = ACTION_LABEL[row.actionKind] ?? row.actionKind;
  const body = row.campaignName ? `after ${label} · ${row.campaignName}` : `after ${label}`;

  return {
    id: `outcome:${row.id}`,
    time: formatTime(row.windowEndedAt),
    timestampIso: row.windowEndedAt.toISOString(),
    kind: "observed",
    head,
    body,
  };
}

function formatTime(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
