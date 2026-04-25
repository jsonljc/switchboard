import type { FunnelShapeSchema as FunnelShape } from "@switchboard/schemas";

interface StageTemplate {
  name: string;
  metricKey: string;
}

export function detectFunnelShape(destinationType: string): FunnelShape {
  if (destinationType === "ON_AD") return "instant_form";
  if (destinationType === "WHATSAPP" || destinationType.includes("WHATSAPP")) return "whatsapp";
  return "website";
}

const websiteStages: StageTemplate[] = [
  { name: "Impressions", metricKey: "impressions" },
  { name: "Clicks", metricKey: "clicks" },
  { name: "Landing Page Views", metricKey: "landing_page_views" },
  { name: "Leads", metricKey: "leads" },
  { name: "Qualified", metricKey: "qualified" },
  { name: "Closed", metricKey: "closed" },
];

const instantFormStages: StageTemplate[] = [
  { name: "Impressions", metricKey: "impressions" },
  { name: "Clicks", metricKey: "clicks" },
  { name: "Leads", metricKey: "leads" },
  { name: "Qualified", metricKey: "qualified" },
  { name: "Closed", metricKey: "closed" },
];

const whatsappStages: StageTemplate[] = [
  { name: "Impressions", metricKey: "impressions" },
  { name: "Clicks", metricKey: "clicks" },
  { name: "Conversations Started", metricKey: "conversations_started" },
  { name: "First Reply", metricKey: "first_reply" },
  { name: "Qualified", metricKey: "qualified" },
  { name: "Closed", metricKey: "closed" },
];

const stageTemplates: Record<FunnelShape, StageTemplate[]> = {
  website: websiteStages,
  instant_form: instantFormStages,
  whatsapp: whatsappStages,
};

export function getFunnelStageTemplate(shape: FunnelShape): StageTemplate[] {
  return stageTemplates[shape];
}
