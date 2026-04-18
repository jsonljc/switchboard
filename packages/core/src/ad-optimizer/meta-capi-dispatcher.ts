import { createHash } from "node:crypto";
import type { AdConversionDispatcher, DispatchResult } from "./ad-conversion-dispatcher.js";
import type { ConversionEvent } from "../events/conversion-bus.js";

const API_BASE = "https://graph.facebook.com/v21.0";

interface MetaCAPIConfig {
  pixelId: string;
  accessToken: string;
}

type FetchFn = typeof globalThis.fetch;

export class MetaCAPIDispatcher implements AdConversionDispatcher {
  readonly platform = "meta_capi";
  private readonly config: MetaCAPIConfig;
  private readonly fetchFn: FetchFn;

  constructor(config: MetaCAPIConfig, fetchFn: FetchFn = globalThis.fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  canDispatch(event: ConversionEvent): boolean {
    return !!(event.sourceAdId || event.metadata?.["fbclid"]);
  }

  async dispatch(event: ConversionEvent): Promise<DispatchResult> {
    const eventName = event.type === "purchased" ? "Purchase" : "Lead";
    const fbclid = event.metadata?.["fbclid"] as string | undefined;

    const userData: Record<string, string> = {};
    if (fbclid) {
      userData.fbc = `fb.1.${event.occurredAt.getTime()}.${fbclid}`;
    }
    if (event.metadata?.["email"]) {
      userData.em = sha256((event.metadata["email"] as string).toLowerCase().trim());
    }
    if (event.metadata?.["phone"]) {
      userData.ph = sha256((event.metadata["phone"] as string).replace(/\D/g, ""));
    }

    const body = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(event.occurredAt.getTime() / 1000),
          user_data: userData,
          custom_data: event.value ? { value: event.value, currency: "SGD" } : undefined,
          action_source: "system_generated",
        },
      ],
    };

    const url = `${API_BASE}/${this.config.pixelId}/events`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return { accepted: false, errorMessage: `HTTP ${response.status}: ${text}` };
    }

    const result = await response.json();
    return { accepted: true, responsePayload: result };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
