// ---------------------------------------------------------------------------
// Shared RecommendationOutcomeReadModel → ActivityRow translator.
//
// Extracted from routes/cockpit/riley/outcomes.ts in slice 3 so both the
// dedicated outcomes route and the cockpit activity feed render outcome rows
// identically. Slice 3 appends the allowlisted trust-signal suffix to `head`
// (the agent-panel work log renders only `head`; body/tag are dropped there).
//
// Honesty floors:
// - off-allowlist copy templates render null and the row is dropped
//   (fail-closed, B.2 guardrail);
// - trustDelta null (legacy rows) or "none" renders no suffix — output is
//   byte-identical to pre-slice-3 copy.
// ---------------------------------------------------------------------------
import { renderOutcomeCopy, renderTrustDeltaCopy } from "@switchboard/schemas";
import type { ActivityRow } from "@switchboard/schemas";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";

const ACTION_LABEL: Record<string, string> = {
  pause: "pause",
  refresh_creative: "creative refresh",
};

export function translateOutcomeToActivityRow(
  row: RecommendationOutcomeReadModel,
): ActivityRow | null {
  if (!row.copyTemplate || !row.copyValues) return null;
  const outcomeCopy = renderOutcomeCopy(row.copyTemplate, row.copyValues);
  if (outcomeCopy === null) return null; // fail-closed on off-allowlist template

  const trustCopy = renderTrustDeltaCopy(row.trustDelta);
  const head = trustCopy ? `${outcomeCopy} ${trustCopy}` : outcomeCopy;

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
