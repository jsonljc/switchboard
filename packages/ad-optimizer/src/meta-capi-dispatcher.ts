import { createHash } from "node:crypto";
import type { AdConversionDispatcher, DispatchResult } from "./ad-conversion-dispatcher.js";
import type { ConversionEvent, ConversionStage } from "@switchboard/schemas";

const API_BASE = "https://graph.facebook.com/v21.0";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const META_EVENT_NAME: Record<ConversionStage, string> = {
  inquiry: "Contact",
  qualified: "QualifiedLead",
  booked: "ConvertedLead",
  purchased: "Purchase",
  completed: "Purchase",
};

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
    const email = event.customer?.email ?? (event.metadata?.["email"] as string | undefined);
    const phone = event.customer?.phone ?? (event.metadata?.["phone"] as string | undefined);
    const leadId =
      event.attribution?.lead_id ?? (event.metadata?.["lead_id"] as string | undefined);
    const fbclid = event.attribution?.fbclid ?? (event.metadata?.["fbclid"] as string | undefined);

    return Boolean(leadId || fbclid || email || phone);
  }

  async dispatch(event: ConversionEvent): Promise<DispatchResult> {
    if (event.occurredAt.getTime() < Date.now() - SEVEN_DAYS_MS) {
      console.warn("[MetaCAPIDispatcher] Skipping event: event_time_too_old", event.eventId);
      return { accepted: false, errorMessage: "event_time_too_old" };
    }

    const leadId =
      event.attribution?.lead_id ?? (event.metadata?.["lead_id"] as string | undefined);
    const fbclid = event.attribution?.fbclid ?? (event.metadata?.["fbclid"] as string | undefined);
    const eventSourceUrl = event.attribution?.eventSourceUrl;
    const clientUserAgent = event.attribution?.clientUserAgent;
    const fbclidTimestamp = event.attribution?.fbclidTimestamp;

    const email = event.customer?.email ?? (event.metadata?.["email"] as string | undefined);
    const phone = event.customer?.phone ?? (event.metadata?.["phone"] as string | undefined);

    const userData: Record<string, string> = {};
    let actionSource: string;
    let eventSourceUrlValue: string | undefined;

    if (event.actionSource) {
      actionSource = event.actionSource;
      if (leadId) {
        userData.lead_id = leadId;
      }
      if (fbclid) {
        userData.fbc = buildFbc(fbclid, fbclidTimestamp ?? event.occurredAt);
      }
      if (eventSourceUrl) {
        eventSourceUrlValue = eventSourceUrl;
      }
      if (clientUserAgent) {
        userData.client_user_agent = clientUserAgent;
      }
    } else if (leadId) {
      actionSource = "crm";
      userData.lead_id = leadId;
    } else if (fbclid && eventSourceUrl && clientUserAgent) {
      actionSource = "website";
      eventSourceUrlValue = eventSourceUrl;
      userData.client_user_agent = clientUserAgent;
      userData.fbc = buildFbc(fbclid, fbclidTimestamp ?? event.occurredAt);
    } else {
      actionSource = "system_generated";
      if (fbclid) {
        userData.fbc = buildFbc(fbclid, fbclidTimestamp ?? event.occurredAt);
      }
    }

    if (email) {
      userData.em = sha256(email.toLowerCase().trim());
    }
    if (phone) {
      userData.ph = sha256(phone.replace(/\D/g, ""));
    }

    let customData: { value: number; currency: string } | undefined;
    if (event.value != null && event.currency) {
      customData = { value: event.value, currency: event.currency };
    } else if (event.value != null && !event.currency) {
      console.warn(
        "[MetaCAPIDispatcher] missing_currency_for_value, omitting custom_data",
        event.eventId,
      );
    }

    const body = {
      data: [
        {
          event_name: META_EVENT_NAME[event.type],
          event_time: Math.floor(event.occurredAt.getTime() / 1000),
          event_id: event.eventId,
          user_data: userData,
          action_source: actionSource,
          ...(eventSourceUrlValue ? { event_source_url: eventSourceUrlValue } : {}),
          ...(customData ? { custom_data: customData } : {}),
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

function buildFbc(fbclid: string, timestamp: Date): string {
  return `fb.1.${timestamp.getTime()}.${fbclid}`;
}
