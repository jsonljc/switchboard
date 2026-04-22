import Link from "next/link";

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
      <div className="space-y-2">
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
          Choose what you want to tune
        </h1>
        <p className="max-w-2xl text-[15px] leading-6 text-muted-foreground">
          Open a settings area to tighten Alex&apos;s playbook, connect channels, or review operator
          controls before launch.
        </p>
      </div>

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
