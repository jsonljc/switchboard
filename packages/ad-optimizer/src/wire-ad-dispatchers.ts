import type { ConversionBus } from "@switchboard/schemas";
import type { AdConversionDispatcher } from "./ad-conversion-dispatcher.js";

interface DispatchLogStoreSubset {
  record(input: {
    eventId: string;
    platform: string;
    status: string;
    errorMessage?: string | null;
    responsePayload?: unknown;
  }): Promise<unknown>;
}

export function wireAdDispatchers(
  bus: ConversionBus,
  dispatchers: AdConversionDispatcher[],
  dispatchLogStore: DispatchLogStoreSubset,
): void {
  bus.subscribe("*", async (event) => {
    for (const d of dispatchers) {
      if (!d.canDispatch(event)) continue;

      try {
        const result = await d.dispatch(event);
        await dispatchLogStore.record({
          eventId: event.eventId,
          platform: d.platform,
          status: result.accepted ? "accepted" : "rejected",
          errorMessage: result.errorMessage ?? null,
          responsePayload: result.responsePayload,
        });
      } catch (err) {
        await dispatchLogStore.record({
          eventId: event.eventId,
          platform: d.platform,
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  });
}
