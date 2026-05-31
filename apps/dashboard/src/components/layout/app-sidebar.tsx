"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { cn } from "@/lib/utils";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import { isMercuryToolLive, type ToolsNavId } from "@/lib/route-availability";

// ─── Pure logic (no React) ────────────────────────────────────────────────────

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
  // Full reports (/reports) is the advanced operator surface, shown whenever the
  // reports tool is live (the same gate ToolsOverflow uses). The "reports" TOOLS
  // item itself points at /results and was already deduped against primary
  // Results above, so /reports is the only reports entry that survives.
  if (opts.liveToolIds.includes("reports"))
    tools.push({ label: "Full reports", href: "/reports", icon: FileText });
  return {
    primary: PRIMARY,
    tools,
    settings: { label: "Settings", href: "/settings", icon: Settings },
  };
}

// ─── React component ──────────────────────────────────────────────────────────

const ALL_TOOL_IDS: ToolsNavId[] = ["contacts", "automations", "reports"];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ item, pathname }: { item: SidebarItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-colors duration-fast",
        active
          ? "text-foreground font-medium bg-surface"
          : "text-muted-foreground hover:text-foreground hover:bg-surface/50",
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname() ?? "/";
  const { enabled: miraEnabled } = useMiraEnabled({ poll: false });
  const liveToolIds = ALL_TOOL_IDS.filter((id) => isMercuryToolLive(id));
  const { primary, tools, settings } = buildSidebarSections({
    miraEnabled: miraEnabled ?? false,
    liveToolIds,
  });
  return (
    <nav className="app-sidebar" aria-label="Primary">
      <div className="space-y-0.5">
        {primary.map((i) => (
          <NavLink key={i.href} item={i} pathname={pathname} />
        ))}
      </div>
      {tools.length > 0 && (
        <div className="space-y-0.5 mt-4 pt-4" style={{ borderTop: "1px solid var(--hair-soft)" }}>
          {tools.map((i) => (
            <NavLink key={i.href} item={i} pathname={pathname} />
          ))}
        </div>
      )}
      <div className="space-y-0.5 mt-4 pt-4" style={{ borderTop: "1px solid var(--hair-soft)" }}>
        <NavLink item={settings} pathname={pathname} />
      </div>
    </nav>
  );
}
