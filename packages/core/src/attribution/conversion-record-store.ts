import type { ConversionEvent } from "../events/conversion-bus.js";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface FunnelCounts {
  inquiry: number;
  qualified: number;
  booked: number;
  purchased: number;
  completed: number;
  totalRevenue: number;
  period: DateRange;
}

export interface CampaignFunnel extends FunnelCounts {
  campaignId: string;
}

export interface ChannelFunnel extends FunnelCounts {
  channel: string;
}

export interface AgentFunnel extends FunnelCounts {
  deploymentId: string;
  deploymentName: string;
}

export interface ConversionRecordStore {
  record(event: ConversionEvent): Promise<void>;
  funnelByOrg(orgId: string, dateRange: DateRange): Promise<FunnelCounts>;
  funnelByCampaign(orgId: string, dateRange: DateRange): Promise<CampaignFunnel[]>;
  funnelByChannel(orgId: string, dateRange: DateRange): Promise<ChannelFunnel[]>;
  funnelByAgent(orgId: string, dateRange: DateRange): Promise<AgentFunnel[]>;
}
