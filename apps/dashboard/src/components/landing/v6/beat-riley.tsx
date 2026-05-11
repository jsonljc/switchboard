import { ArrowSig } from "./glyphs";
import { Reveal } from "./reveal";

const LOOP = [
  { num: "01", name: "Plan", detail: "brief → media plan · Mon", state: "done" },
  { num: "02", name: "Launch", detail: "12 ad sets shipped · Tue", state: "done" },
  { num: "03", name: "Optimize", detail: "drafting reallocation · now", state: "current" },
  { num: "04", name: "Approve", detail: "awaits your tap", state: "pending" },
  { num: "05", name: "Measure", detail: "7-day lift report", state: "pending" },
] as const;

const STATS = [
  { label: "Spend · 7d", num: "$3,184", delta: "▲ 4% vs prior", dir: "up" as const },
  { label: "Leads", num: "87", delta: "▼ 11% vs prior", dir: "down" as const },
  { label: "CPL · blended", num: "$36.60", delta: "▼ 17% efficiency", dir: "down" as const },
  { label: "ROAS", num: "2.4×", delta: "▼ 0.4 vs prior", dir: "down" as const },
];

const ROWS = [
  {
    name: "Whitening · CTWA · CDMX",
    flag: false,
    pill: { kind: "on" as const, text: "Active" },
    spend: "$842",
    cpl: "$24.80",
    cpa: { dir: "up" as const, text: "▲ 6%" },
    ctr: { dir: "up" as const, text: "▲ 9%" },
    roas: { dir: "neutral" as const, text: "3.1×" },
  },
  {
    name: "Cleaning · retarget · 30d",
    flag: true,
    pill: { kind: "warn" as const, text: "Drafting pause" },
    spend: "$596",
    cpl: "$78.40",
    cpa: { dir: "down" as const, text: "▼ 38%", strong: true },
    ctr: { dir: "down" as const, text: "▼ 22%" },
    roas: { dir: "down" as const, text: "1.2×" },
  },
  {
    name: "Implants · lookalike 1%",
    flag: false,
    pill: { kind: "on" as const, text: "Active" },
    spend: "$910",
    cpl: "$31.20",
    cpa: { dir: "up" as const, text: "▲ 2%" },
    ctr: { dir: "neutral" as const, text: "— 0%" },
    roas: { dir: "neutral" as const, text: "2.7×" },
  },
  {
    name: "Aligners · CTWA · prospect",
    flag: false,
    pill: { kind: "on" as const, text: "Active" },
    spend: "$612",
    cpl: "$42.10",
    cpa: { dir: "down" as const, text: "▼ 8%" },
    ctr: { dir: "up" as const, text: "▲ 5%" },
    roas: { dir: "neutral" as const, text: "2.0×" },
  },
  {
    name: "Brand · search · evergreen",
    flag: false,
    pill: { kind: "on" as const, text: "Active" },
    spend: "$224",
    cpl: "$11.80",
    cpa: { dir: "up" as const, text: "▲ 11%" },
    ctr: { dir: "up" as const, text: "▲ 14%" },
    roas: { dir: "neutral" as const, text: "4.2×" },
  },
];

const BULLETS = [
  ["Plans", " campaigns from a brief — objective, audience, budget, structure"],
  ["Reads", " spend, CPL, CPA, ROAS by ad set"],
  ["Finds", " budget leaks before they become habits"],
  ["Drafts", " pauses, reallocations, audience swaps, and launch plans"],
  ["Compares", " what changed against what happened"],
  ["Reports", " the next move in plain English"],
];

function dirClass(dir: "up" | "down" | "neutral", strong = false) {
  if (dir === "up") return "text-v6-good";
  if (dir === "down") return strong ? "text-v6-coral font-semibold" : "text-v6-coral";
  return "text-v6-graphite-3";
}

export function V6BeatNova() {
  return (
    <section
      id="nova"
      data-screen-label="04 Nova"
      className="border-t border-[hsl(20_8%_14%_/_0.06)]"
    >
      {/* Full-bleed dashboard band */}
      <div className="flex w-full flex-col items-center gap-6 px-4 pt-32 max-[900px]:pt-20">
        {/* Process loop */}
        <Reveal
          as="ol"
          aria-label="What Nova does, end to end"
          className="grid w-full max-w-[78rem] list-none grid-cols-5 overflow-hidden rounded-[0.85rem] border border-[hsl(20_8%_14%_/_0.12)] bg-[hsl(28_30%_96%)] max-[780px]:grid-cols-2"
        >
          {LOOP.map((s, i) => {
            const last = i === LOOP.length - 1;
            return (
              <li
                key={s.num}
                className={`v6-nl-step ${s.state} relative flex flex-col gap-[0.2rem] border-r border-[hsl(20_8%_14%_/_0.06)] px-[1.1rem] py-4 transition-colors ${
                  last ? "border-r-0" : ""
                } ${s.state === "current" ? "bg-white" : ""} ${
                  s.state === "pending" ? "opacity-55" : ""
                } max-[780px]:border-b max-[780px]:border-b-[hsl(20_8%_14%_/_0.06)]`}
              >
                <span
                  className={`v6-nl-num font-mono-v6 text-[10px] font-medium tracking-[0.08em] ${
                    s.state === "current" ? "text-v6-coral" : "text-v6-graphite-3"
                  }`}
                >
                  {s.num}
                </span>
                <span
                  className="v6-nl-name text-[1.15rem] font-medium italic leading-tight tracking-[-0.01em]"
                  style={{ fontFamily: "Georgia, ui-serif, serif" }}
                >
                  <span
                    className={
                      s.state === "current"
                        ? "text-v6-graphite"
                        : s.state === "done"
                          ? "text-v6-graphite-2"
                          : "text-v6-graphite-3"
                    }
                  >
                    {s.name}
                  </span>
                </span>
                <span
                  className={`v6-nl-detail font-mono-v6 inline-flex items-center gap-[0.4rem] text-[10.5px] font-medium tracking-[0.04em] ${
                    s.state === "current" ? "text-v6-coral" : "text-v6-graphite-2"
                  }`}
                >
                  {s.detail}
                </span>
              </li>
            );
          })}
        </Reveal>

        {/* Dashboard surface */}
        <Reveal
          aria-label="Meta Ads dashboard fragment"
          className="flex w-full max-w-[78rem] flex-col overflow-hidden rounded-2xl border border-[hsl(20_8%_14%_/_0.12)] bg-white shadow-[0_30px_80px_hsl(20_30%_30%_/_0.08),0_1px_0_hsl(20_12%_4%_/_0.04)]"
        >
          {/* Header */}
          <header className="flex items-center justify-between border-b border-[hsl(20_8%_14%_/_0.06)] bg-[hsl(28_30%_96%)] px-[1.4rem] py-4 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.06em] text-v6-graphite-2">
            <span className="flex flex-wrap items-center gap-[0.5rem]">
              <span className="text-v6-graphite">Switchboard · for Aurora Dental</span>
              <span className="text-v6-graphite-4">·</span>
              <span>Meta Ads · last 7 days</span>
            </span>
            <span className="inline-flex items-center gap-[0.5rem] text-v6-coral">
              <span className="v6-dash-pulse relative h-[6px] w-[6px] rounded-full bg-v6-coral" />
              Nova · drafting
            </span>
          </header>

          {/* Stats */}
          <div className="grid grid-cols-4 border-b border-[hsl(20_8%_14%_/_0.06)] max-[760px]:grid-cols-2">
            {STATS.map((s, i) => (
              <div
                key={s.label}
                className={`flex flex-col gap-[0.35rem] border-r border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] py-5 ${
                  i === STATS.length - 1 ? "border-r-0" : ""
                } max-[760px]:border-b max-[760px]:border-b-[hsl(20_8%_14%_/_0.06)] ${
                  i % 2 === 1 ? "max-[760px]:border-r-0" : ""
                }`}
              >
                <span className="font-mono-v6 text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
                  {s.label}
                </span>
                <span
                  className="text-[1.85rem] font-medium tracking-[-0.018em] text-v6-graphite"
                  style={{ fontFeatureSettings: '"tnum"' }}
                >
                  {s.num}
                </span>
                <span
                  className={`font-mono-v6 text-[11px] font-medium tracking-[0.04em] ${
                    s.dir === "up" ? "text-v6-good" : "text-v6-coral"
                  }`}
                >
                  {s.delta}
                </span>
              </div>
            ))}
          </div>

          {/* Table */}
          <table className="w-full border-collapse text-sm text-v6-graphite">
            <thead>
              <tr>
                {["Ad set", "Status", "Spend", "CPL", "CPA Δ", "CTR Δ", "ROAS"].map((h, i) => (
                  <th
                    key={h}
                    className={`border-b border-[hsl(20_8%_14%_/_0.06)] bg-[hsl(28_30%_97%)] px-[1.4rem] py-[0.85rem] font-mono-v6 text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 ${
                      i >= 2 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.name} className={r.flag ? "bg-[hsl(14_75%_55%_/_0.04)]" : ""}>
                  <td className="border-b border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] py-[0.85rem]">
                    <span className="inline-flex items-center gap-[0.5rem] font-medium">
                      {r.flag && (
                        <span className="h-[6px] w-[6px] rounded-full bg-v6-coral shadow-[0_0_0_4px_hsl(14_75%_55%_/_0.15)]" />
                      )}
                      {r.name}
                    </span>
                  </td>
                  <td className="border-b border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] py-[0.85rem]">
                    <span
                      className={`font-mono-v6 inline-block rounded-full px-[0.55rem] py-[0.2rem] text-[10px] font-medium uppercase tracking-[0.06em] ${
                        r.pill.kind === "on"
                          ? "bg-[hsl(140_38%_32%_/_0.1)] text-v6-good"
                          : "bg-[hsl(14_75%_55%_/_0.12)] text-v6-coral"
                      }`}
                    >
                      {r.pill.text}
                    </span>
                  </td>
                  <td
                    className="border-b border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] py-[0.85rem] text-right"
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {r.spend}
                  </td>
                  <td
                    className="border-b border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] py-[0.85rem] text-right"
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {r.cpl}
                  </td>
                  <td
                    className={`border-b border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] py-[0.85rem] text-right ${dirClass(r.cpa.dir, "strong" in r.cpa && r.cpa.strong)}`}
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {r.cpa.text}
                  </td>
                  <td
                    className={`border-b border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] py-[0.85rem] text-right ${dirClass(r.ctr.dir)}`}
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {r.ctr.text}
                  </td>
                  <td
                    className={`border-b border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] py-[0.85rem] text-right ${dirClass(r.roas.dir)}`}
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {r.roas.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Nova note */}
          <aside className="flex gap-4 border-t border-[hsl(14_75%_55%_/_0.15)] bg-[hsl(14_75%_55%_/_0.04)] px-[1.6rem] py-[1.4rem]">
            <span className="flex h-[2.4rem] w-[2.4rem] flex-shrink-0 items-center justify-center rounded-lg border border-[hsl(20_8%_14%_/_0.06)] bg-white text-v6-coral">
              <svg viewBox="0 0 48 48" className="h-[1.4rem] w-[1.4rem]">
                <use href="#mark-nova" />
              </svg>
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="font-mono-v6 text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-coral">
                Nova · 6:41am · draft
              </span>
              <p className="text-[0.9375rem] leading-[1.5] text-v6-graphite">
                <b className="font-medium">Cleaning · retarget · 30d</b> — period-over-period CPA up
                38% vs. 7-day baseline; CTR down 22%. Audience appears saturated.{" "}
                <b className="font-medium">Recommend pause.</b> Reallocate $40/day to Whitening ·
                CTWA (CPA −12% vs. baseline). Awaiting your review.
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <span className="inline-flex cursor-pointer items-center whitespace-nowrap rounded-full bg-v6-graphite px-[0.9rem] py-[0.5rem] text-[0.8125rem] font-medium text-v6-cream">
                  Approve pause →
                </span>
                <span className="inline-flex cursor-pointer items-center whitespace-nowrap rounded-full border border-[hsl(20_8%_14%_/_0.12)] bg-white px-[0.9rem] py-[0.5rem] text-[0.8125rem] font-medium text-v6-graphite-2">
                  Edit allocation
                </span>
                <span className="inline-flex cursor-pointer items-center whitespace-nowrap rounded-full border border-[hsl(20_8%_14%_/_0.12)] bg-white px-[0.9rem] py-[0.5rem] text-[0.8125rem] font-medium text-v6-graphite-2">
                  Dismiss
                </span>
              </div>
            </div>
          </aside>
        </Reveal>
      </div>

      <p className="font-mono-v6 mx-auto mt-4 w-full max-w-[78rem] px-4 text-center text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
        Illustrative example. Actual numbers vary by account.
      </p>

      {/* Body text below dashboard */}
      <div className="mx-auto w-full max-w-[78rem] px-4 pb-32 pt-16 max-[900px]:pb-20 max-[900px]:pt-12">
        <Reveal className="flex flex-col gap-[1.4rem]">
          <div className="flex items-center justify-between gap-4 border-b border-[hsl(20_8%_14%_/_0.12)] pb-5 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-2">
            <span className="inline-flex items-center">
              <span className="mr-2 inline-block h-[6px] w-[6px] rounded-full bg-v6-coral align-middle" />
              <span>04 — Ad optimization</span>
            </span>
            <span>a 02 / · nova · paid spend</span>
          </div>

          <div className="grid items-start gap-x-20 gap-y-12 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] max-[900px]:grid-cols-1 max-[900px]:gap-8">
            <div className="flex max-w-[38rem] flex-col gap-[1.4rem]">
              <span className="font-mono-v6 inline-flex items-center gap-[0.55rem] text-[11px] font-medium uppercase tracking-[0.06em] text-v6-graphite-3">
                <span className="inline-flex h-[1.1rem] w-[1.1rem] items-center justify-center">
                  <svg viewBox="0 0 48 48" className="h-full w-full">
                    <use href="#mark-nova" />
                  </svg>
                </span>
                a 02 — Nova · paid spend
              </span>
              <h2
                className="text-balance font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
                style={{ fontSize: "clamp(2rem, 3.8vw, 3.5rem)" }}
              >
                <span className="block font-normal text-v6-graphite-2">
                  Bad ad sets don&rsquo;t pause themselves.
                </span>
                <span className="block font-semibold text-v6-graphite">
                  Nova finds the waste and{" "}
                  <em className="font-semibold not-italic text-v6-coral">drafts the fix</em>.
                </span>
              </h2>
              <p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
                Nova is your ad operator on shift. She plans campaigns, reads performance, spots
                budget leaks, prepares changes, and turns the next move into a reviewable draft.{" "}
                <b className="font-medium text-v6-graphite">You approve what goes live.</b>
              </p>
              <div className="mt-2">
                <a
                  href="#pricing"
                  className="inline-flex items-center gap-[0.4rem] border-b border-[hsl(20_8%_14%_/_0.12)] pb-[0.2rem] text-[0.95rem] font-medium text-v6-graphite hover:border-v6-graphite"
                >
                  Start with Nova
                  <ArrowSig className="!h-[0.55rem] !w-[0.9rem]" />
                </a>
              </div>
            </div>

            <ul className="mt-2 grid grid-cols-1 gap-[0.85rem] border-t border-[hsl(20_8%_14%_/_0.12)] pt-6">
              {BULLETS.map(([head, tail]) => (
                <li
                  key={head}
                  className="relative pl-[1.05rem] text-[0.95rem] leading-[1.4] text-v6-graphite before:absolute before:left-0 before:top-[0.55rem] before:h-[5px] before:w-[5px] before:rounded-full before:bg-v6-graphite-4 before:content-['']"
                >
                  <b className="font-medium">{head}</b>
                  {tail}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
