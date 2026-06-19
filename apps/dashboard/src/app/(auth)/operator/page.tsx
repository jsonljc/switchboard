import type { Metadata } from "next";
import { PageTitle } from "@/components/layout/page-title";
import { ProposedDisqualificationsPanel } from "./_components/proposed-disqualifications-panel";

export const metadata: Metadata = { title: "Operator Queue — Switchboard" };

export default function OperatorPage() {
  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Operator" sub="Review and action items that require operator input.">
        Operator Queue
      </PageTitle>
      {/* TODO(3c): hide panel when qualification flag is off (spec §7.1 polish).
           Today the panel renders an empty state ("No proposals pending") when the
           capability is disabled — functionally correct but a phantom affordance.
           Hiding requires a server-side capability fetch; deferred to 3c. */}
      <ProposedDisqualificationsPanel />
    </div>
  );
}
