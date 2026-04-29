import { ArrowSig } from "./glyphs";
import { Reveal } from "./reveal";

interface Card {
  agent: "alex" | "nova" | "mira";
  name: string;
  job: string;
  /** Pilot floor. Always rendered as "From $X / month". */
  price: string;
  /** One-line description of what the operator does. */
  subtitle: string;
  cta: string;
  /** mailto: target — pilot inbound goes through email until a real onboarding flow exists. */
  ctaHref: string;
  featured: boolean;
  hint?: string;
}

const CARDS: Card[] = [
  {
    agent: "alex",
    name: "Alex",
    job: "lead reply",
    price: "$249",
    subtitle: "Lead response and booking operator.",
    cta: "Start with Alex",
    ctaHref: "mailto:hello@switchboard.ai?subject=Start%20with%20Alex",
    featured: true,
    hint: "Recommended starting point",
  },
  {
    agent: "nova",
    name: "Nova",
    job: "ad optimizer",
    price: "$249",
    subtitle: "Ad planning and optimization operator.",
    cta: "Start with Nova",
    ctaHref: "mailto:hello@switchboard.ai?subject=Start%20with%20Nova",
    featured: false,
  },
  {
    agent: "mira",
    name: "Mira",
    job: "creative",
    price: "$399",
    subtitle: "Creative direction and production operator.",
    cta: "Start with Mira",
    ctaHref: "mailto:hello@switchboard.ai?subject=Start%20with%20Mira",
    featured: false,
  },
];

export function V6Pricing() {
  return (
    <section
      id="pricing"
      data-screen-label="07 Pricing"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-28 max-[900px]:py-20"
    >
      <div className="v6-beat-frame">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-10 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
          <span className="inline-flex items-center gap-[0.6rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
            <span>07 — Plans</span>
          </span>
          <span>Hire by the seat</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <Reveal className="mb-14 flex flex-col items-center gap-3 text-center">
          <h2
            className="max-w-[18ch] font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
            style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
          >
            Hire one. Or hire the <em className="font-semibold not-italic">desk</em>.
          </h2>
          <p className="max-w-[36rem] text-base text-v6-graphite-2">
            Each agent does one thing exceptionally. Bundle when you&rsquo;re ready — they share
            context as they go.
          </p>
        </Reveal>

        <div className="mx-auto grid w-full grid-cols-3 gap-5 max-[900px]:max-w-[28rem] max-[900px]:grid-cols-1">
          {CARDS.map((c) => (
            <Reveal key={c.agent}>
              <article
                className={`relative flex flex-col gap-5 rounded-2xl border p-8 pb-7 transition-[transform,box-shadow] duration-300 hover:-translate-y-[3px] ${
                  c.featured
                    ? "v6-pcard-featured border-[hsl(14_75%_55%_/_0.35)] bg-white shadow-[0_1px_0_hsl(20_12%_4%_/_0.03),0_0_0_1px_hsl(14_75%_55%_/_0.18)_inset,0_20px_50px_hsl(20_30%_30%_/_0.06)]"
                    : "border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-2 shadow-[0_1px_0_hsl(20_12%_4%_/_0.03),0_16px_40px_hsl(20_30%_30%_/_0.03)] hover:shadow-[0_1px_0_hsl(20_12%_4%_/_0.03),0_24px_60px_hsl(20_30%_30%_/_0.07)]"
                }`}
              >
                <header className="flex items-center gap-[0.7rem] border-b border-[hsl(20_8%_14%_/_0.06)] pb-[1.1rem]">
                  <span className="flex h-[2.4rem] w-[2.4rem] items-center justify-center rounded-lg border border-[hsl(20_8%_14%_/_0.06)] bg-white">
                    <svg viewBox="0 0 48 48" className="h-[1.6rem] w-[1.6rem]">
                      <use href={`#mark-${c.agent}`} />
                    </svg>
                  </span>
                  <span className="text-[1.25rem] font-semibold tracking-[-0.012em] text-v6-graphite">
                    {c.name}
                  </span>
                  <span className="font-mono-v6 ml-auto text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
                    {c.job}
                  </span>
                </header>

                <div className="-mt-1 flex flex-col gap-[0.4rem]">
                  <span className="font-mono-v6 text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
                    From
                  </span>
                  <div className="flex items-baseline gap-[0.5rem]">
                    <span
                      className="whitespace-nowrap text-[2.875rem] font-medium leading-none tracking-[-0.025em] text-v6-graphite"
                      style={{ fontFeatureSettings: '"tnum","ss01"' }}
                    >
                      {c.price}
                    </span>
                    <span className="inline-flex items-baseline whitespace-nowrap text-[0.9375rem] tracking-[0.005em] text-v6-graphite-2">
                      <span className="mr-[0.3em] inline-block translate-y-[0.06em] text-[1.125rem] font-light leading-none text-v6-graphite-3">
                        /
                      </span>
                      month
                    </span>
                  </div>
                </div>

                <p className="text-[0.95rem] leading-[1.4] text-v6-graphite">{c.subtitle}</p>

                <a
                  href={c.ctaHref}
                  className={`mt-auto inline-flex w-full items-center justify-center gap-[0.65rem] whitespace-nowrap rounded-full px-6 py-[0.85rem] text-sm font-medium tracking-[-0.005em] transition-[transform,background-color,box-shadow] duration-[250ms] hover:-translate-y-px ${
                    c.featured
                      ? "bg-v6-graphite text-v6-cream shadow-[0_1px_0_hsl(20_12%_4%_/_0.15)] hover:bg-black hover:text-v6-cream hover:shadow-[0_8px_24px_hsl(20_12%_4%_/_0.18)]"
                      : "border border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-2 text-v6-graphite hover:bg-v6-cream"
                  }`}
                >
                  {c.cta}
                  <ArrowSig className="!h-[0.7rem] !w-[1.05rem]" />
                </a>

                {c.hint && (
                  <span className="v6-pcard-hint font-mono-v6 -mt-2 inline-flex items-center justify-center gap-[0.45rem] text-center text-[10px] font-medium uppercase tracking-[0.08em] text-v6-coral">
                    {c.hint}
                  </span>
                )}
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-14 flex flex-col items-center">
          <p className="font-mono-v6 max-w-[36rem] text-center text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
            Pilot pricing. Final pricing may vary by channels, spend level, and operator setup.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
