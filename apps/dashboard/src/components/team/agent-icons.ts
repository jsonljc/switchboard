import { Brain, Eye, MessageSquare, Gauge, Calendar, Shield, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const AGENT_ICONS: Record<string, LucideIcon> = {
  strategist: Brain,
  monitor: Eye,
  responder: MessageSquare,
  optimizer: Gauge,
  booker: Calendar,
  guardian: Shield,
  primary_operator: Sparkles,
};

export const AGENT_ROLE_LABELS: Record<string, string> = {
  strategist: "Manages your ad campaigns",
  monitor: "Tracks what's working",
  responder: "Replies to new leads",
  optimizer: "Adjusts your budget",
  booker: "Schedules appointments",
  guardian: "Reviews risky actions",
  primary_operator: "Your main assistant",
};
