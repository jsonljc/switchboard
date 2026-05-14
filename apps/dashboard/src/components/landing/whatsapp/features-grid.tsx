import { BeatFrame } from "./beat-frame";

const FEATURES = [
  {
    num: "/01/",
    title: "Approved templates",
    body: "Author and submit. We surface rejections with reasons and a one-click rewrite path.",
  },
  {
    num: "/02/",
    title: "Multi-number",
    body: "Run several display numbers behind one inbox. Route by team, region, or campaign.",
  },
  {
    num: "/03/",
    title: "Quality monitoring",
    body: "Track quality rating in-app. Alerts before throttling kicks in, not after.",
  },
  {
    num: "/04/",
    title: "Opt-in / opt-out audit",
    body: "Every consent event logged with timestamp, channel, and source. Exportable.",
  },
  {
    num: "/05/",
    title: "24h-window awareness",
    body: "Alex knows the session clock. Free-form inside; template fallback outside.",
  },
  {
    num: "/06/",
    title: "Operator governance",
    body: "Drafts, holds, and audit trails on every message Alex sends. Pull the leash any time.",
  },
];

export function WhatsAppFeaturesGrid() {
  return (
    <section className="relative border-t border-[hsl(20_8%_14%_/_0.06)] bg-v6-cream-2 py-28 max-[900px]:py-20">
      <BeatFrame left="03 — Platform surface" right="what the BSP layer covers" />

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <h2
          className="mb-14 max-w-[26ch] font-medium leading-[1.1] tracking-[-0.014em] text-v6-graphite"
          style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
        >
          The plumbing is the floor, not the ceiling.
        </h2>

        <div className="grid grid-cols-3 border-t border-[hsl(20_8%_14%_/_0.12)] max-[900px]:grid-cols-1">
          {FEATURES.map((f, i) => {
            const col = i % 3;
            return (
              <div
                key={f.num}
                className={`flex min-h-[11rem] flex-col gap-[0.85rem] border-b border-[hsl(20_8%_14%_/_0.12)] p-8 ${
                  col !== 2 ? "border-r border-[hsl(20_8%_14%_/_0.12)] max-[900px]:border-r-0" : ""
                }`}
              >
                <span className="font-mono-v6 text-[11px] uppercase tracking-[0.08em] text-v6-graphite-3">
                  {f.num}
                </span>
                <h3 className="text-[1.25rem] font-medium tracking-[-0.012em] text-v6-graphite">
                  {f.title}
                </h3>
                <p className="text-[0.9375rem] leading-[1.5] text-v6-graphite-2">{f.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
