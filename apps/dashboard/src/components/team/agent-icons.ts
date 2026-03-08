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
  strategist: "Strategist",
  monitor: "Monitor",
  responder: "Responder",
  optimizer: "Optimizer",
  booker: "Booker",
  guardian: "Guardian",
  primary_operator: "Operator",
};
