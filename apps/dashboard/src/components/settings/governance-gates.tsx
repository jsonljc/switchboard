"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { GovernanceGateUnit, GovernanceMode } from "@switchboard/schemas";

export interface GateCardModel {
  unit: GovernanceGateUnit;
  currentMode: GovernanceMode;
  ready: boolean;
  blockingReason: string | null;
  producer: { kind: string; count: number };
  review: {
    wouldBlock: number;
    wouldRewrite: number;
    wouldEscalate: number;
    wouldTemplate: number;
    total: number;
  };
}

const GATE_LABELS: Record<GovernanceGateUnit, string> = {
  deterministic: "Banned phrases & pricing",
  claims: "Efficacy claims",
  consent: "PDPA consent",
  whatsapp: "WhatsApp 24-hour window",
};

const MODE_BADGE: Record<
  GovernanceMode,
  { label: string; variant: "secondary" | "positive" | "outline" }
> = {
  off: { label: "Off", variant: "outline" },
  observe: { label: "Observing", variant: "secondary" },
  enforce: { label: "Enforcing", variant: "positive" },
};

function reviewSummary(r: GateCardModel["review"]): string {
  return `Over the last 7 days, enforcing would have blocked ${r.wouldBlock}, rewritten ${r.wouldRewrite}, escalated ${r.wouldEscalate}${
    r.wouldTemplate > 0 ? `, templated ${r.wouldTemplate}` : ""
  } of ${r.total} flagged repl${r.total === 1 ? "y" : "ies"}.`;
}

export function GovernanceGates({
  gates,
  pendingUnit,
  onFlip,
}: {
  gates: GateCardModel[];
  pendingUnit: GovernanceGateUnit | null;
  onFlip: (unit: GovernanceGateUnit, mode: GovernanceMode) => void;
}) {
  const [confirmUnit, setConfirmUnit] = useState<GovernanceGateUnit | null>(null);
  const confirmGate = gates.find((g) => g.unit === confirmUnit) ?? null;

  return (
    <div className="space-y-4">
      {gates.map((g) => {
        const badge = MODE_BADGE[g.currentMode];
        const isEnforcing = g.currentMode === "enforce";
        const pending = pendingUnit === g.unit;
        return (
          <Card key={g.unit} data-testid={`gate-card-${g.unit}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{GATE_LABELS[g.unit]}</CardTitle>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{reviewSummary(g.review)}</p>
              {!g.ready && !isEnforcing ? (
                <p className="text-sm text-caution-foreground" role="note">
                  {g.blockingReason}
                </p>
              ) : null}
              <div className="flex gap-2">
                {isEnforcing ? (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => onFlip(g.unit, "observe")}
                  >
                    Return to observe
                  </Button>
                ) : (
                  <Button
                    disabled={!g.ready || pending}
                    onClick={() => setConfirmUnit(g.unit)}
                    aria-label={`Enforce ${GATE_LABELS[g.unit]}`}
                  >
                    Enforce
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Dialog
        open={confirmUnit !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUnit(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Enforce {confirmGate ? GATE_LABELS[confirmGate.unit] : "this gate"}?
            </DialogTitle>
            <DialogDescription>
              Enforcing blocks or rewrites matching replies and hands the conversation to a human.
              If the governance system is briefly unavailable, this gate will block matching replies
              rather than allow them. You can return to observe at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUnit(null)}>
              Cancel
            </Button>
            <Button
              data-testid="confirm-enforce"
              onClick={() => {
                if (confirmUnit) onFlip(confirmUnit, "enforce");
                setConfirmUnit(null);
              }}
            >
              Enforce
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
