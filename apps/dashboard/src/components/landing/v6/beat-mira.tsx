import { ArrowSig } from "./glyphs";
import { Reveal } from "./reveal";

export function V6BeatMira() {
  return (
    <section
      id="mira"
      data-screen-label="05 Mira"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-32 max-[900px]:py-20"
    >
      <div className="v6-beat-frame">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-10 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
          <span className="inline-flex items-center gap-[0.6rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
            <span>05 — Creative pipeline</span>
          </span>
          <span>a 03 / · mira · creative</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="grid items-center gap-x-20 gap-y-16 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] max-[900px]:grid-cols-1 max-[900px]:gap-10">
          <Reveal className="order-1 max-[900px]:order-2">
            <CreativeStrip />
          </Reveal>

          <Reveal className="order-2 flex max-w-[30rem] flex-col gap-[1.4rem] max-[900px]:order-1">
            <span className="font-mono-v6 inline-flex items-center gap-[0.55rem] text-[11px] font-medium uppercase tracking-[0.06em] text-v6-graphite-3">
              <span className="inline-flex h-[1.1rem] w-[1.1rem] items-center justify-center">
                <svg viewBox="0 0 48 48" className="h-full w-full">
                  <use href="#mark-mira" />
                </svg>
              </span>
              a 03 — Mira · creative
            </span>
            <h2
              className="text-balance font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
              style={{ fontSize: "clamp(2rem, 3.8vw, 3.5rem)" }}
            >
              <span className="block font-normal text-v6-graphite-2">
                Your next ad has been{" "}
                <em className="font-semibold not-italic text-v6-coral">
                  &ldquo;almost ready&rdquo;
                </em>
              </span>
              <span className="block font-normal text-v6-graphite-2">for two weeks.</span>
              <span className="block font-semibold text-v6-graphite">
                Mira ships while you&rsquo;re in a meeting.
              </span>
            </h2>
            <p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
              Hooks, scripts, storyboards, video drafts.{" "}
              <b className="font-medium text-v6-graphite">Stop at any stage</b> and take what fits.
              You stay director — Mira never auto-publishes.
            </p>
            <ul className="grid w-full grid-cols-1 gap-[0.85rem] border-t border-[hsl(20_8%_14%_/_0.12)] pt-6">
              {[
                [
                  <span key="hook">
                    <b className="font-medium">Hook generation</b> tuned to your brief
                  </span>,
                  null,
                ],
                ["Scripts, storyboards, video drafts", null],
                ["Stop at any stage and take what fits", null],
                ["You stay director, always", null],
              ].map(([a, b], i) => (
                <li
                  key={i}
                  className="relative pl-[1.05rem] text-[0.95rem] leading-[1.4] text-v6-graphite before:absolute before:left-0 before:top-[0.55rem] before:h-[5px] before:w-[5px] before:rounded-full before:bg-v6-graphite-4 before:content-['']"
                >
                  {a}
                  {b && <b className="font-medium">{b}</b>}
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <a
                href="#pricing"
                className="inline-flex items-center gap-[0.4rem] border-b border-[hsl(20_8%_14%_/_0.12)] pb-[0.2rem] text-[0.95rem] font-medium text-v6-graphite hover:border-v6-graphite"
              >
                Start with Mira
                <ArrowSig className="!h-[0.55rem] !w-[0.9rem]" />
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function CreativeStrip() {
  return (
    <div
      className="grid w-full grid-cols-3 gap-[0.85rem] max-[900px]:grid-cols-1"
      aria-label="A creative pipeline: brief to script to clip"
    >
      {/* 01 brief */}
      <article className="flex min-h-[360px] flex-col overflow-hidden rounded-[0.7rem] border border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-2 shadow-[0_1px_0_hsl(20_12%_4%_/_0.03)]">
        <header className="flex justify-between border-b border-[hsl(20_8%_14%_/_0.06)] px-[0.8rem] py-[0.65rem] font-mono-v6 text-[10px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
          <span className="text-v6-graphite">01 / brief</span>
          <span>in · 9:14am</span>
        </header>
        <div className="flex flex-1 flex-col gap-[0.45rem] px-[0.9rem] py-[0.85rem] text-[0.8125rem] leading-[1.5] text-v6-graphite-2">
          <p>
            <b className="font-medium text-v6-graphite">Reel #14.</b> 30s · vertical.
          </p>
          <p>
            For <b className="font-medium text-v6-graphite">Aurora Dental</b> — push whitening
            package, $99 first session. Tone: warm, not clinical. Hook in 1.2s.
          </p>
          <p className="font-mono-v6 mt-auto border-t border-[hsl(20_8%_14%_/_0.06)] pt-[0.6rem] text-[10px] font-medium uppercase tracking-[0.06em] text-v6-coral">
            Mira: trend scan running…
          </p>
        </div>
      </article>

      {/* 02 script */}
      <article className="flex min-h-[360px] flex-col overflow-hidden rounded-[0.7rem] border border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-2 shadow-[0_1px_0_hsl(20_12%_4%_/_0.03)]">
        <header className="flex justify-between border-b border-[hsl(20_8%_14%_/_0.06)] px-[0.8rem] py-[0.65rem] font-mono-v6 text-[10px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
          <span className="text-v6-graphite">02 / script</span>
          <span>draft · 9:31am</span>
        </header>
        <div className="font-mono-v6 flex flex-1 flex-col gap-[0.45rem] px-[0.9rem] py-[0.85rem] text-[0.75rem] leading-[1.55] text-v6-graphite">
          <p className="font-medium uppercase tracking-[0.08em] text-[9.5px] text-v6-graphite-3">
            [Hook · 0:00–0:02]
          </p>
          <p>&ldquo;Three coffees. Two reds. One you you don&rsquo;t recognize in photos.&rdquo;</p>
          <p className="mt-[0.35rem] font-medium uppercase tracking-[0.08em] text-[9.5px] text-v6-graphite-3">
            [Reveal · 0:02–0:06]
          </p>
          <p>Cut to whitening session, natural light. No clinical sterility.</p>
          <p className="mt-[0.35rem] font-medium uppercase tracking-[0.08em] text-[9.5px] text-v6-graphite-3">
            [Offer · 0:21–0:28]
          </p>
          <p>&ldquo;$99 first session. Whitening that looks like you, brighter.&rdquo;</p>
          <p className="mt-[0.6rem] border-t border-[hsl(20_8%_14%_/_0.06)] pt-[0.6rem] text-[10px] font-medium uppercase tracking-[0.06em] text-v6-coral">
            Mira: 3 hooks tested. Hook 2 wins.
          </p>
        </div>
      </article>

      {/* 03 clip */}
      <article className="flex min-h-[360px] flex-col overflow-hidden rounded-[0.7rem] border border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-2 shadow-[0_1px_0_hsl(20_12%_4%_/_0.03)]">
        <header className="flex justify-between border-b border-[hsl(20_8%_14%_/_0.06)] px-[0.8rem] py-[0.65rem] font-mono-v6 text-[10px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
          <span className="text-v6-graphite">03 / draft clip</span>
          <span>render · 11:08am</span>
        </header>
        <div className="flex flex-1 flex-col p-0">
          <ClipCanvas />
          <p className="font-mono-v6 m-0 border-t border-[hsl(20_8%_14%_/_0.06)] px-[0.9rem] py-[0.65rem] text-[10px] font-medium uppercase tracking-[0.06em] text-v6-coral">
            Mira: ready for your review. Will not publish.
          </p>
        </div>
      </article>
    </div>
  );
}

function ClipCanvas() {
  return (
    <div className="relative aspect-[9/12] overflow-hidden">
      <svg
        viewBox="0 0 200 280"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="mira-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(28 35% 92%)" />
            <stop offset="55%" stopColor="hsl(24 28% 78%)" />
            <stop offset="100%" stopColor="hsl(20 22% 60%)" />
          </linearGradient>
          <radialGradient id="mira-light" cx=".62" cy=".34" r=".6">
            <stop offset="0%" stopColor="hsl(40 60% 90%)" stopOpacity=".9" />
            <stop offset="55%" stopColor="hsl(30 40% 84%)" stopOpacity=".4" />
            <stop offset="100%" stopColor="hsl(20 20% 60%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="mira-vig" cx=".5" cy=".5" r=".7">
            <stop offset="60%" stopColor="hsl(20 20% 10%)" stopOpacity="0" />
            <stop offset="100%" stopColor="hsl(20 20% 10%)" stopOpacity=".3" />
          </radialGradient>
        </defs>
        <rect width="200" height="280" fill="url(#mira-bg)" />
        <rect width="200" height="280" fill="url(#mira-light)" />
        <g opacity=".68">
          <path
            d="M 36 280 L 36 200 Q 36 160, 100 160 Q 164 160, 164 200 L 164 280 Z"
            fill="hsl(18 14% 38%)"
          />
          <rect x="86" y="135" width="28" height="32" fill="hsl(18 14% 42%)" rx="3" />
          <ellipse cx="100" cy="115" rx="26" ry="30" fill="hsl(18 14% 44%)" />
        </g>
        <ellipse cx="115" cy="115" rx="9" ry="14" fill="hsl(40 60% 90%)" opacity=".25" />
        <path
          d="M 92 130 Q 100 134, 108 130"
          stroke="hsl(40 70% 95%)"
          strokeWidth="1.5"
          fill="none"
          opacity=".55"
          strokeLinecap="round"
        />
        <rect width="200" height="280" fill="url(#mira-vig)" />
        <g opacity=".06">
          <circle cx="40" cy="60" r=".4" fill="#fff" />
          <circle cx="120" cy="40" r=".3" fill="#fff" />
          <circle cx="170" cy="100" r=".4" fill="#fff" />
          <circle cx="60" cy="180" r=".3" fill="#fff" />
          <circle cx="150" cy="220" r=".4" fill="#fff" />
          <circle cx="20" cy="240" r=".3" fill="#fff" />
        </g>
        <g stroke="hsl(20 14% 96% / 0.12)" strokeWidth=".5">
          <line x1="66.7" y1="0" x2="66.7" y2="280" />
          <line x1="133.3" y1="0" x2="133.3" y2="280" />
          <line x1="0" y1="93.3" x2="200" y2="93.3" />
          <line x1="0" y1="186.7" x2="200" y2="186.7" />
        </g>
      </svg>

      <span className="font-mono-v6 absolute left-[0.55rem] top-[0.55rem] rounded-[0.25rem] bg-[hsl(20_12%_9%_/_0.75)] px-[0.45rem] py-[0.18rem] text-[10px] font-medium tracking-[0.06em] text-v6-cream">
        00:08 / 00:30
      </span>

      <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-white/30 bg-[hsl(20_12%_9%_/_0.42)] backdrop-blur-md [-webkit-backdrop-filter:blur(8px)]">
        <span
          className="ml-[0.18rem] block h-0 w-0 border-y-[0.45rem] border-l-[0.7rem] border-y-transparent"
          style={{ borderLeftColor: "hsl(28 30% 90%)" }}
        />
      </span>

      <span className="absolute bottom-[1.4rem] left-[0.55rem] right-[0.55rem] rounded-[0.3rem] bg-[hsl(20_12%_9%_/_0.55)] p-[0.4rem_0.6rem] text-center text-[0.7rem] italic leading-[1.35] text-v6-cream backdrop-blur-md [-webkit-backdrop-filter:blur(8px)]">
        &ldquo;…you you don&rsquo;t recognize in photos.&rdquo;
      </span>

      <span className="absolute bottom-[0.5rem] left-[0.55rem] right-[0.55rem] h-[3px] overflow-hidden rounded-[1.5px] bg-[hsl(20_12%_9%_/_0.35)]">
        <span className="v6-mira-timeline-fill relative block h-full w-[27%] bg-v6-cream" />
      </span>
    </div>
  );
}
