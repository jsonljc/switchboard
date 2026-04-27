// TODO(post-wedge): OutcomeDispatcher must REPLACE, not run beside, MetaCAPIDispatcher
// after a dedicated event_name dependency audit:
//   - Which CAPI event_names are currently sent (ConvertedLead, etc.)?
//   - Which Meta datasets/custom conversions consume them?
//   - Are campaigns optimizing against ConvertedLead, Schedule, Lead, or Purchase?
//   - What breaks if booked transitions from ConvertedLead to Schedule?
//   - Should OutcomeDispatcher preserve legacy event_names initially, then migrate?
// Until that audit ships, this wiring stays dormant. The active CAPI path is
// `MetaCAPIDispatcher` subscribed via `wireAdDispatchers` (or wherever it's wired).
//
// This module is currently UNUSED in production bootstrap; it exists as a building
// block for the future re-wiring. The contract is exercised by the co-located
// outcome-wiring.test.ts so the helper stays correct while dormant.
import type { OutcomeDispatcher, OutcomeEvent } from "@switchboard/ad-optimizer";

/**
 * Minimal bus interface required for outcome wiring. The wiring layer is
 * decoupled from the broader ConversionBus contract: it only needs a string
 * keyed subscribe() that delivers `{ contactId, value?, currency? }` payloads.
 *
 * Bootstrap is responsible for adapting the application's actual lifecycle
 * event source (e.g. ConversionBus, Inngest events) onto this interface.
 */
export interface LifecycleEventBus {
  subscribe(
    event: string,
    handler: (payload: { contactId: string; value?: number; currency?: string }) => Promise<void>,
  ): void;
}

interface DispatcherLike {
  handle(event: OutcomeEvent): Promise<void>;
}

const KIND_MAP: Record<string, OutcomeEvent["kind"]> = {
  "lifecycle.qualified": "qualified",
  "lifecycle.booked": "booked",
  "lifecycle.showed": "showed",
  "lifecycle.paid": "paid",
};

/**
 * Subscribes the OutcomeDispatcher to lifecycle stage transition events on a
 * LifecycleEventBus. Each lifecycle.* event triggers a CAPI dispatch via the
 * OutcomeDispatcher.
 *
 * Idempotency: at-least-once delivery is mitigated downstream by deterministic
 * CAPI event_ids (synthesized in MetaCAPIDispatcher from `event.eventId`),
 * so duplicate deliveries dedupe at Meta's side.
 *
 * Validation: KIND_MAP statically constrains output kinds to OutcomeKindSchema
 * values, so no runtime parse is required here. The bus interface enforces the
 * payload shape via TypeScript; bootstrap-level adapters are the trust boundary.
 */
export function subscribeOutcomeDispatcher(deps: {
  bus: LifecycleEventBus;
  dispatcher: DispatcherLike;
}): void {
  for (const [event, kind] of Object.entries(KIND_MAP)) {
    deps.bus.subscribe(event, async (payload) => {
      try {
        await deps.dispatcher.handle({
          contactId: payload.contactId,
          kind,
          value: payload.value,
          currency: payload.currency,
        });
      } catch (err) {
        console.error(
          `[outcome-wiring] dispatcher.handle failed for ${event} contact=${payload.contactId}:`,
          err,
        );
      }
    });
  }
}

// Re-export for convenience at call sites.
export type { OutcomeDispatcher };
