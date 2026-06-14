import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type { ConsentCompletenessData } from "@switchboard/schemas";

export async function computeConsentCompleteness(
  ctx: RollupContext,
  contacts: ReportStores["contacts"],
): Promise<ConsentCompletenessData> {
  const { bookable, validConsent } = await contacts.countConsentCompleteness({ orgId: ctx.orgId });
  return { validConsent, bookable, rate: bookable > 0 ? validConsent / bookable : null };
}
