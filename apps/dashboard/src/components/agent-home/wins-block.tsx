"use client";

import type { AgentKey } from "@switchboard/schemas";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { WinsViewModel, WinViewModel } from "@/lib/agent-home/types";
import { ProseSegments } from "./prose-segments";
import { FixtureFolioBadge } from "./fixture-folio-badge";
import { useUndoWin } from "@/hooks/use-undo-win";

export function WinsBlock({ vm, agentKey }: { vm: WinsViewModel; agentKey: AgentKey }) {
  const agentName = AGENT_REGISTRY[agentKey].displayName;
  return (
    <section className="section page-wide" data-block="wins" data-testid="block-wins">
      <div className="folio">
        <span className="folio-l">Recent wins</span>
        <span className="folio-r">
          Today
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      {vm.wins.length === 0 ? (
        <p className="empty-state">
          <em>No recent wins yet. {agentName} is waiting for the next approved action.</em>
        </p>
      ) : (
        <div className="wins-grid">
          {vm.wins.map((w) => (
            <WinTile key={w.id} win={w} agentKey={agentKey} />
          ))}
        </div>
      )}
    </section>
  );
}

function WinTile({ win, agentKey }: { win: WinViewModel; agentKey: AgentKey }) {
  const { mutate, isPending } = useUndoWin();
  return (
    <article className="win">
      <span className="win-folio">WIN — {win.timeFolio}</span>
      <p className="win-prose">
        <ProseSegments segments={win.proseSegments} />
      </p>
      <div className="win-foot">
        {win.undo.available && (
          <button
            type="button"
            className="win-undo"
            onClick={() => mutate({ winId: win.id, agentKey })}
            disabled={isPending}
          >
            Undo
          </button>
        )}
        {!win.undo.available && win.undo.unavailableReason === "expired" && (
          <span className="win-undo-expired">
            <em>Undo window closed</em>
          </span>
        )}
      </div>
    </article>
  );
}
