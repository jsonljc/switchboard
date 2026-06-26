import type { ConversionBus } from "@switchboard/core";
import { MetaCAPIClient } from "@switchboard/ad-optimizer";

export function wireCAPIDispatcher(
  bus: ConversionBus,
  config: { pixelId: string; accessToken: string },
): void {
  const client = new MetaCAPIClient(config);

  bus.subscribe("*", async (event) => {
    if (!event.sourceAdId) return;

    const eventName = event.type === "purchased" ? "Purchase" : "Lead";

    try {
      await client.dispatchEvent({
        eventName,
        eventTime: Math.floor(event.occurredAt.getTime() / 1000),
        userData: { fbclid: (event.metadata["fbclid"] as string) ?? null },
        // Currency comes from the event (market-derived upstream), never hardcoded.
        // Include it only when present, matching the live MetaCAPIDispatcher's handling
        // of a value with no currency (omit rather than guess).
        customData: event.value
          ? { value: event.value, ...(event.currency ? { currency: event.currency } : {}) }
          : undefined,
      });
    } catch (err) {
      console.error("[CAPIWiring] Failed to dispatch event:", err);
    }
  });
}
