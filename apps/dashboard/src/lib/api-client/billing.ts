import { SwitchboardKnowledgeClient } from "./knowledge";

export interface BillingStatus {
  subscriptionId: string | null;
  status: "active" | "trialing" | "past_due" | "canceled" | "none";
  planName: string | null;
  priceId: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface CheckoutResult {
  url: string;
}

export interface PortalResult {
  url: string;
}

export class SwitchboardBillingClient extends SwitchboardKnowledgeClient {
  async getBillingStatus(): Promise<BillingStatus> {
    return this.request("/api/billing/status");
  }

  async createCheckout(priceId: string): Promise<CheckoutResult> {
    return this.request("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ priceId }),
    });
  }

  async createPortalSession(): Promise<PortalResult> {
    return this.request("/api/billing/portal", { method: "POST" });
  }
}
