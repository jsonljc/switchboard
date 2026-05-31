import {
  Home,
  Inbox,
  BarChart3,
  Users,
  Workflow,
  FileText,
  Sparkles,
  Settings,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ToolsNavId } from "@/lib/route-availability";

export interface SidebarItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

export interface SidebarSections {
  primary: SidebarItem[];
  tools: SidebarItem[];
  settings: SidebarItem;
}

const PRIMARY: SidebarItem[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Results", href: "/results", icon: BarChart3 },
];

const TOOLS: Array<SidebarItem & { id: ToolsNavId }> = [
  { id: "contacts", label: "Pipeline", href: "/contacts", icon: Users },
  { id: "automations", label: "Automations", href: "/automations", icon: Workflow },
  { id: "reports", label: "Reports", href: "/results", icon: BarChart3 },
];

export function buildSidebarSections(opts: {
  miraEnabled: boolean;
  liveToolIds: ReadonlyArray<ToolsNavId>;
}): SidebarSections {
  const primaryHrefs = new Set(PRIMARY.map((i) => i.href));
  const tools: SidebarItem[] = TOOLS.filter((t) => opts.liveToolIds.includes(t.id))
    .filter((t) => !primaryHrefs.has(t.href))
    .map(({ id: _id, ...item }) => item);
  if (opts.miraEnabled) tools.push({ label: "Mira", href: "/mira", icon: Sparkles });
  // Full reports (/reports) is the advanced operator surface. It is shown
  // when: (a) the reports tool is live AND (b) no other regular tool items are
  // visible — preventing a duplicate-ish experience when Pipeline/Automations
  // are already populating the tools section.
  if (opts.liveToolIds.includes("reports") && tools.length === 0)
    tools.push({ label: "Full reports", href: "/reports", icon: FileText });
  return {
    primary: PRIMARY,
    tools,
    settings: { label: "Settings", href: "/settings", icon: Settings },
  };
}
