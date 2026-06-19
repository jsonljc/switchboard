import Link from "next/link";
import { PageTitle } from "@/components/layout/page-title";

const SETTINGS_SHORTCUTS = [
  {
    href: "/settings/playbook",
    label: "Your Playbook",
    description: "Refine what Alex knows, how it qualifies leads, and when it escalates.",
  },
  {
    href: "/settings/team",
    label: "Team",
    description: "Adjust your AI roster, responsibilities, and operator handoff rules.",
  },
  {
    href: "/settings/channels",
    label: "Channels",
    description: "Connect WhatsApp, Telegram, and other inbound channels before launch.",
  },
] as const;

export default function SettingsPage() {
  return (
    <section className="space-y-6">
      <PageTitle
        eyebrow="Settings"
        sub="Open a settings area to tighten Alex's playbook, connect channels, or review operator controls before launch."
      >
        Choose what you want to tune
      </PageTitle>

      <div className="grid gap-3 md:grid-cols-3">
        {SETTINGS_SHORTCUTS.map((shortcut) => (
          <Link
            key={shortcut.href}
            href={shortcut.href}
            className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-foreground/20 hover:bg-surface"
          >
            <div className="space-y-2">
              <h2 className="text-[16px] font-semibold text-foreground">{shortcut.label}</h2>
              <p className="text-[14px] leading-6 text-muted-foreground">{shortcut.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
