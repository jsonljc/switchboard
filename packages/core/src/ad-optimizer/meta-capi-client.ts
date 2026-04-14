// packages/core/src/ad-optimizer/meta-capi-client.ts
import type { CAPIEventSchema as CAPIEvent } from "@switchboard/schemas";

const API_BASE = "https://graph.facebook.com/v21.0";

interface MetaCAPIClientConfig {
  pixelId: string;
  accessToken: string;
}

interface CAPIErrorBody {
  error: {
    message: string;
  };
}

interface CAPIResponseBody {
  events_received: number;
}

export class MetaCAPIClient {
  private readonly pixelId: string;
  private readonly accessToken: string;

  constructor(config: MetaCAPIClientConfig) {
    this.pixelId = config.pixelId;
    this.accessToken = config.accessToken;
  }

  async dispatchEvent(event: CAPIEvent): Promise<{ eventsReceived: number }> {
    const url = `${API_BASE}/${this.pixelId}/events`;

    const userData: Record<string, unknown> = {};
    if (event.userData.fbclid) {
      userData["fbc"] = `fb.1.${Date.now()}.${event.userData.fbclid}`;
    }
    if (event.userData.email) {
      userData["em"] = [event.userData.email];
    }
    if (event.userData.phone) {
      userData["ph"] = [event.userData.phone];
    }

    const body = {
      data: [
        {
          event_name: event.eventName,
          event_time: event.eventTime,
          user_data: userData,
          custom_data: event.customData,
          action_source: "system_generated",
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = "Unknown error";
      try {
        const errorBody = (await response.json()) as CAPIErrorBody;
        if (errorBody.error?.message) {
          message = errorBody.error.message;
        }
      } catch {
        // JSON parsing failed, use default message
      }
      throw new Error(`CAPI error (${response.status}): ${message}`);
    }

    const result = (await response.json()) as CAPIResponseBody;
    return { eventsReceived: result.events_received };
  }
}
