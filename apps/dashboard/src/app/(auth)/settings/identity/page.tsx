"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAgentRoster, useUpdateAgentRoster } from "@/hooks/use-agents";
import { OperatorCharacter } from "@/components/character/operator-character";
import type {
  RoleFocus,
  WorkingStyle,
  Tone,
  Autonomy,
} from "@/components/character/operator-character";

/* ─── Pill selector ─── */
function Pill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-lg text-[13px] font-medium border transition-all duration-default",
        selected
          ? "bg-surface border-foreground/70 text-foreground shadow-sm"
          : "bg-surface-raised border-border text-muted-foreground hover:text-foreground hover:border-border-subtle hover:bg-surface",
      )}
    >
      {label}
    </button>
  );
}

/* ─── Section label ─── */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="section-label block mb-2.5">{children}</span>;
}

interface StoredConfig {
  roleFocus: RoleFocus;
  workingStyle: WorkingStyle;
  tone: Tone;
  autonomy: Autonomy;
  focusAreas: string[];
}

const DEFAULT_CONFIG: StoredConfig = {
  roleFocus: "default",
  workingStyle: "responsive",
  tone: "professional",
  autonomy: "sometimes",
  focusAreas: ["sales", "follow-up"],
};

/* ─── Focus area options ─── */
const FOCUS_AREAS = [
  { id: "sales", label: "Sales & outreach" },
  { id: "follow-up", label: "Follow-up" },
  { id: "scheduling", label: "Scheduling" },
  { id: "content", label: "Content" },
];

/* ─── Status line builder ─── */
function buildStatusLine(config: StoredConfig): string {
  const roleMap: Record<RoleFocus, string> = {
    leads: "focused on leads",
    bookings: "focused on bookings",
    care: "focused on customer care",
    growth: "focused on growth",
    default: "ready to help",
  };
  const styleMap: Record<WorkingStyle, string> = {
    proactive: "proactive",
    responsive: "responsive",
    methodical: "methodical",
  };
  const autonomyMap: Record<Autonomy, string> = {
    full: "working autonomously",
    sometimes: "checking in when needed",
    always: "waiting for your go-ahead",
  };
  return `${roleMap[config.roleFocus]} · ${styleMap[config.workingStyle]} · ${autonomyMap[config.autonomy]}`;
}

export default function SettingsIdentityPage() {
  const { status } = useSession();
  const { data: rosterData } = useAgentRoster();
  const updateAgent = useUpdateAgentRoster();

  // Start with DEFAULT_CONFIG so server and client render identically (no hydration mismatch).
  const [config, setConfig] = useState<StoredConfig>(DEFAULT_CONFIG);
  const [nameInput, setNameInput] = useState("");
  const [nameSaved, setNameSaved] = useState(false);

  // Load config from roster when data arrives
  useEffect(() => {
    const primary = rosterData?.roster?.find((a) => a.agentRole === "primary_operator");
    if (primary?.config) {
      const saved = primary.config as Partial<StoredConfig>;
      setConfig((prev) => ({
        ...prev,
        ...(saved.roleFocus ? { roleFocus: saved.roleFocus } : {}),
        ...(saved.workingStyle ? { workingStyle: saved.workingStyle } : {}),
        ...(saved.tone ? { tone: saved.tone } : {}),
        ...(saved.autonomy ? { autonomy: saved.autonomy } : {}),
        ...(saved.focusAreas ? { focusAreas: saved.focusAreas } : {}),
      }));
    }
    if (primary?.displayName && !nameInput) {
      setNameInput(primary.displayName);
    }
  }, [rosterData, nameInput]);

  if (status === "unauthenticated") redirect("/login");

  const persistConfig = useCallback(
    (next: StoredConfig) => {
      const primary = rosterData?.roster?.find((a) => a.agentRole === "primary_operator");
      if (!primary) return;
      updateAgent.mutate({
        id: primary.id,
        config: {
          ...(primary.config as Record<string, unknown>),
          roleFocus: next.roleFocus,
          workingStyle: next.workingStyle,
          tone: next.tone,
          autonomy: next.autonomy,
          focusAreas: next.focusAreas,
        },
      });
    },
    [rosterData, updateAgent],
  );

  const updateConfig = useCallback(
    <K extends keyof StoredConfig>(key: K, value: StoredConfig[K]) => {
      setConfig((prev) => {
        const next = { ...prev, [key]: value };
        persistConfig(next);
        return next;
      });
    },
    [persistConfig],
  );

  const toggleFocusArea = useCallback(
    (id: string) => {
      setConfig((prev) => {
        const next = {
          ...prev,
          focusAreas: prev.focusAreas.includes(id)
            ? prev.focusAreas.filter((f) => f !== id)
            : [...prev.focusAreas, id],
        };
        persistConfig(next);
        return next;
      });
    },
    [persistConfig],
  );

  const saveName = useCallback(() => {
    const primary = rosterData?.roster?.find((a) => a.agentRole === "primary_operator");
    if (!primary || !nameInput.trim() || nameInput === primary.displayName) return;
    updateAgent.mutate(
      { id: primary.id, displayName: nameInput.trim() },
      {
        onSuccess: () => {
          setNameSaved(true);
          setTimeout(() => setNameSaved(false), 2000);
        },
      },
    );
  }, [nameInput, rosterData, updateAgent]);

  const displayName = nameInput || "Your assistant";

  return (
    <div className="flex h-full min-h-[calc(100vh-56px)]">
      {/* ── Left Panel: Identity ── */}
      <aside className="hidden lg:flex flex-col justify-center w-[26rem] shrink-0 px-10 xl:px-14 border-r border-border/40">
        <div className="space-y-8 animate-fade-in-up">
          {/* Name */}
          <div>
            <FieldLabel>Name</FieldLabel>
            <div className="flex gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                placeholder="Give your assistant a name"
                className={cn(
                  "flex-1 h-11 px-4 rounded-lg border text-[15px] bg-surface outline-none transition-colors duration-fast",
                  "border-border focus:border-foreground/60 placeholder:text-muted-foreground/50",
                )}
              />
              {nameSaved && (
                <span className="self-center text-[12px] text-positive animate-fade-in-up">
                  Saved
                </span>
              )}
            </div>
          </div>

          {/* Role Focus */}
          <div>
            <FieldLabel>Role focus</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {(["leads", "bookings", "care", "growth"] as RoleFocus[]).map((r) => (
                <Pill
                  key={r}
                  label={
                    r === "leads"
                      ? "Leads & Sales"
                      : r === "bookings"
                        ? "Bookings"
                        : r === "care"
                          ? "Customer Care"
                          : "Business Growth"
                  }
                  selected={config.roleFocus === r}
                  onClick={() => updateConfig("roleFocus", r)}
                />
              ))}
            </div>
          </div>

          {/* Working Style */}
          <div>
            <FieldLabel>Working style</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {(["proactive", "responsive", "methodical"] as WorkingStyle[]).map((s) => (
                <Pill
                  key={s}
                  label={s.charAt(0).toUpperCase() + s.slice(1)}
                  selected={config.workingStyle === s}
                  onClick={() => updateConfig("workingStyle", s)}
                />
              ))}
            </div>
          </div>

          {/* Tone */}
          <div>
            <FieldLabel>Tone</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {(["warm", "professional", "concise", "friendly"] as Tone[]).map((t) => (
                <Pill
                  key={t}
                  label={t.charAt(0).toUpperCase() + t.slice(1)}
                  selected={config.tone === t}
                  onClick={() => updateConfig("tone", t)}
                />
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* ── Center: Character ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 py-12">
        {/* Character */}
        <div className="relative w-full max-w-[320px] aspect-[3/4] mb-6">
          <OperatorCharacter
            roleFocus={config.roleFocus}
            workingStyle={config.workingStyle}
            tone={config.tone}
            autonomy={config.autonomy}
            className="w-full h-full"
          />
        </div>

        {/* Name & status */}
        <div className="text-center space-y-2">
          <h1
            className="font-display font-light text-5xl md:text-6xl tracking-tight text-foreground leading-none"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {displayName}
          </h1>
          <p className="text-[13px] text-muted-foreground tracking-wide">
            {buildStatusLine(config)}
          </p>
        </div>

        {/* Mobile controls — collapsed into accordion-style below character */}
        <div className="lg:hidden mt-10 w-full max-w-sm space-y-6">
          <MobilePanels config={config} onUpdate={updateConfig} onToggleFocus={toggleFocusArea} />
        </div>
      </main>

      {/* ── Right Panel: Behavior ── */}
      <aside className="hidden lg:flex flex-col justify-center w-[26rem] shrink-0 px-10 xl:px-14 border-l border-border/40">
        <div className="space-y-8 animate-fade-in-up">
          {/* Autonomy */}
          <div>
            <FieldLabel>Autonomy</FieldLabel>
            <div className="space-y-2">
              {(
                [
                  {
                    value: "full",
                    label: "Full auto",
                    desc: "Handles everything independently",
                  },
                  {
                    value: "sometimes",
                    label: "Ask when unsure",
                    desc: "Checks in on important decisions",
                  },
                  {
                    value: "always",
                    label: "Always ask",
                    desc: "You approve everything first",
                  },
                ] as { value: Autonomy; label: string; desc: string }[]
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateConfig("autonomy", opt.value)}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-lg border transition-all duration-default group",
                    config.autonomy === opt.value
                      ? "border-foreground/60 bg-surface shadow-sm"
                      : "border-border bg-surface-raised hover:bg-surface hover:border-border-subtle",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-[5px] w-[5px] rounded-full shrink-0 transition-colors duration-fast",
                        config.autonomy === opt.value ? "bg-foreground" : "bg-border",
                      )}
                    />
                    <div>
                      <p
                        className={cn(
                          "text-[13px] font-medium leading-tight transition-colors",
                          config.autonomy === opt.value
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {opt.label}
                      </p>
                      <p className="text-[12px] text-muted-foreground mt-0.5 leading-tight">
                        {opt.desc}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Focus Areas */}
          <div>
            <FieldLabel>Focus areas</FieldLabel>
            <div className="space-y-1.5">
              {FOCUS_AREAS.map((area) => {
                const checked = config.focusAreas.includes(area.id);
                return (
                  <button
                    key={area.id}
                    onClick={() => toggleFocusArea(area.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-fast",
                      checked
                        ? "bg-surface border border-foreground/30 text-foreground"
                        : "bg-surface-raised border border-transparent text-muted-foreground hover:text-foreground hover:bg-surface",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-[3px] border-[1.5px] flex items-center justify-center shrink-0 transition-colors duration-fast",
                        checked ? "border-foreground bg-foreground" : "border-border",
                      )}
                    >
                      {checked && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path
                            d="M1 4L3.5 6.5L9 1"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                    <span className="text-[13px] font-medium">{area.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Task Scope */}
          <div>
            <FieldLabel>Task scope</FieldLabel>
            <div className="flex gap-2">
              <Pill
                label="Defined tasks"
                selected={!config.focusAreas.includes("open-initiative")}
                onClick={() =>
                  setConfig((prev) => {
                    const next = {
                      ...prev,
                      focusAreas: prev.focusAreas.filter((f) => f !== "open-initiative"),
                    };
                    persistConfig(next);
                    return next;
                  })
                }
              />
              <Pill
                label="Open initiative"
                selected={config.focusAreas.includes("open-initiative")}
                onClick={() => toggleFocusArea("open-initiative")}
              />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ─── Mobile panels (collapsed below character) ─── */
function MobilePanels({
  config,
  onUpdate,
  onToggleFocus: _onToggleFocus,
}: {
  config: StoredConfig;
  onUpdate: <K extends keyof StoredConfig>(key: K, value: StoredConfig[K]) => void;
  onToggleFocus: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Role */}
      <div>
        <FieldLabel>Role focus</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {(["leads", "bookings", "care", "growth"] as RoleFocus[]).map((r) => (
            <Pill
              key={r}
              label={
                r === "leads"
                  ? "Leads"
                  : r === "bookings"
                    ? "Bookings"
                    : r === "care"
                      ? "Care"
                      : "Growth"
              }
              selected={config.roleFocus === r}
              onClick={() => onUpdate("roleFocus", r)}
            />
          ))}
        </div>
      </div>

      {/* Autonomy */}
      <div>
        <FieldLabel>Autonomy</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {(["full", "sometimes", "always"] as Autonomy[]).map((a) => (
            <Pill
              key={a}
              label={
                a === "full" ? "Full auto" : a === "sometimes" ? "Ask when unsure" : "Always ask"
              }
              selected={config.autonomy === a}
              onClick={() => onUpdate("autonomy", a)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
