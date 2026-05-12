import type { Metadata } from "next";
import { ProposedDisqualificationsPanel } from "./_components/proposed-disqualifications-panel";

export const metadata: Metadata = { title: "Operator Queue — Switchboard" };

export default function OperatorPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Operator Queue</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Review and action items that require operator input.
        </p>
      </section>
      <ProposedDisqualificationsPanel />
    </div>
  );
}
