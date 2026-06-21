// Thin adapter: /results FunnelSection delegates to the shared Funnel widget.
// Prop name difference: /results passes `funnel` (array), shared expects `rows`.
import { Funnel } from "@/components/reports-shared/funnel";
import type { FunnelRowData, FunnelNarrative } from "./types";

export function FunnelSection({
  funnel,
  narrative,
}: {
  funnel: FunnelRowData[];
  narrative: FunnelNarrative;
}) {
  return <Funnel rows={funnel} narrative={narrative} />;
}
