// @route-class: read-only
import type { FastifyInstance } from "fastify";
import { renderOutcomeCopy } from "@switchboard/schemas";
import type { ActivityRow } from "@switchboard/schemas";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";
import { requireOrganizationScope } from "../../../utils/require-org.js";

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
  // Dev/test mode: allow `x-org-id` header to set the org scope.
  // In production the auth middleware sets organizationIdFromAuth before handlers run.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
    }
  });

  app.get("/api/cockpit/riley/outcomes", async (req, reply) => {
    const orgId = requireOrganizationScope(req, reply);
    if (!orgId) return;
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
