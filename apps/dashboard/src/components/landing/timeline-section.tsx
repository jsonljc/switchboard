"use client";

import { cn } from "@/lib/utils";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface TimelineEntry {
  time: string;
  text: string;
  agentColor?: string;
  isHandoff?: boolean;
  isPunchline?: boolean;
}

const SALES_TIMELINE: TimelineEntry[] = [
  {
    time: "11:42 PM",
    text: "A lead fills out your contact form.",
  },
  {
    time: "11:42 PM",
    text: "Speed-to-Lead responds. Qualifies the lead in under 60 seconds.",
    agentColor: "hsl(238 28% 52%)",
  },
  {
    time: "11:58 PM",
    text: "Qualified. Hands off to Sales Closer with full context.",
    agentColor: "hsl(238 28% 52%)",
    isHandoff: true,
  },
  {
    time: "12:03 AM",
    text: "Sales Closer handles objections. Books a call for tomorrow at 2 PM.",
    agentColor: "hsl(152 28% 36%)",
  },
  {
    time: "",
    text: "You were asleep the whole time.",
    isPunchline: true,
  },
];

export function TimelineSection() {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.15 });

  return (
    <section id="see-it-in-action" className="py-20 lg:py-28" aria-label="See it in action">
      <div className="page-width">
        <h2 className="font-display text-3xl lg:text-4xl font-light text-center text-foreground mb-12">
          See it in action:{" "}
          <span className="inline-block px-3 py-1 text-base font-mono font-normal rounded border-2 border-border text-muted-foreground align-middle">
            Sales Pipeline
          </span>
        </h2>

        <div
          ref={ref}
          className="max-w-2xl mx-auto rounded-xl border border-border bg-surface p-5 sm:p-8 lg:p-10"
        >
          <div className="relative">
            <div className="absolute left-[3.25rem] top-2 bottom-2 w-px bg-border-subtle" />

            <div className="space-y-6">
              {SALES_TIMELINE.map((entry, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-4 items-start",
                    isVisible && "animate-fade-in-up",
                    entry.isPunchline && "mt-8 justify-center",
                  )}
                  style={
                    isVisible
                      ? { animationDelay: `${i * 300}ms`, animationFillMode: "both" }
                      : { opacity: 0 }
                  }
                >
                  {entry.isPunchline ? (
                    <p className="text-muted-foreground italic text-center">{entry.text}</p>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-muted-foreground w-16 shrink-0 pt-0.5">
                        {entry.time}
                      </span>
                      <div className="flex items-start gap-3">
                        {entry.agentColor && (
                          <div className="flex items-center gap-1 shrink-0 pt-1">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: entry.agentColor }}
                            />
                            {entry.isHandoff && (
                              <>
                                <span className="text-xs text-muted-foreground">&rarr;</span>
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: "hsl(152 28% 36%)" }}
                                />
                              </>
                            )}
                          </div>
                        )}
                        <p className="text-sm text-foreground leading-relaxed">{entry.text}</p>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-8 max-w-lg mx-auto">
          Sales is live today. Creative, Trading, and Finance agents are coming — same trust system,
          same control.
        </p>
      </div>
    </section>
  );
}
