import { ArrowSig } from "./glyphs";
import { Reveal } from "./reveal";

interface Card {
  agent: "alex" | "nova" | "mira";
  name: string;
  job: string;
  price: string;
  strap: string;
  bullets: string[];
  cta: string;
  featured: boolean;
  hint?: string;
}

const CARDS: Card[] = [
  {
    agent: "alex",
    name: "Alex",
    job: "lead reply",
    price: "$199",
    strap: "Replies to leads in seconds.",
    bullets: [
      "1,500 conversations / mo",
      "WhatsApp + Telegram + Web",
      "Approval-first & audited",
      "Books to your real calendar",
    ],
    cta: "Start with Alex",
    featured: true,
    hint: "Recommended starting point",
  },
  {
    agent: "nova",
    name: "Nova",
    job: "ad optimizer",
    price: "$149",
    strap: "Catches bad ad sets before you do.",
    bullets: [
      "$5,000 managed ad spend",
      "Period-over-period diagnosis",
      "Never auto-publishes",
      "Meta Ads via OAuth",
    ],
    cta: "Start with Nova",
    featured: false,
  },
  {
    agent: "mira",
    name: "Mira",
    job: "creative",
    price: "$249",
    strap: "Ships creative while you're busy.",
    bullets: [
      "500 credits / mo",
      "Image · video · storyboard",
      "Stops at any stage",
      "You stay director",
    ],
    cta: "Start with Mira",
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
            what they learn.
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

                <div className="-mt-1 flex items-baseline gap-[0.5rem]">
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

                <p className="text-[0.95rem] font-medium leading-[1.3] text-v6-graphite">
                  {c.strap}
                </p>

                <ul className="mt-1 flex flex-col gap-2 border-t border-[hsl(20_8%_14%_/_0.06)] pt-4">
                  {c.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-[0.6rem] text-sm text-v6-graphite">
                      <svg
                        className="h-[0.55rem] w-3 flex-shrink-0 text-v6-graphite-3"
                        aria-hidden="true"
                      >
                        <use href="#check" />
                      </svg>
                      {b}
                    </li>
                  ))}
                </ul>

                <a
                  href="#closer"
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

        <Reveal className="mt-14 flex flex-col items-center gap-8">
          <div className="flex flex-wrap justify-center gap-[0.6rem]">
            {[
              ["Pick any two", "save 15%"],
              ["Hire all three", "save 25%"],
              ["14-day pilot of the desk", "$199"],
              ["Talk to us about", "Enterprise"],
            ].map(([label, b]) => (
              <span
                key={label}
                className="inline-flex items-center gap-[0.55rem] whitespace-nowrap rounded-full border border-[hsl(20_8%_14%_/_0.06)] bg-v6-cream-2 px-[1.05rem] py-[0.6rem] text-[0.8125rem] text-v6-graphite-2"
              >
                {label} <b className="font-medium text-v6-graphite">{b}</b>
              </span>
            ))}
          </div>

          <details className="v6-pricing-overage w-full max-w-[42rem] overflow-hidden rounded-xl border border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-2">
            <summary className="flex cursor-pointer items-center justify-between px-[1.4rem] py-4 text-[0.9375rem] font-medium text-v6-graphite [&::marker]:hidden">
              <span>What happens if I go over?</span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-[hsl(20_8%_14%_/_0.06)] px-[1.4rem] pb-[1.4rem] pt-5">
              <p className="text-sm leading-[1.5] text-v6-graphite-2">
                Soft caps with predictable rates. Email warnings at 70 / 90 / 100% — no surprise
                bills.
              </p>
              <table className="w-full border-collapse text-[0.8125rem]">
                <tbody>
                  {[
                    ["Alex", "Beyond 1,500 conversations", "$0.15 / conversation"],
                    ["Nova", "Beyond $5k managed spend", "0.75% of incremental spend"],
                    ["Nova", "Beyond 200 operator chats", "$0.20 / chat"],
                    ["Mira", "Beyond 500 credits", "$0.50 / credit"],
                  ].map(([a, b, c], i) => (
                    <tr key={i}>
                      <td className="w-20 border-b border-[hsl(20_8%_14%_/_0.06)] py-[0.55rem] font-medium text-v6-graphite">
                        <b className="font-medium">{a}</b>
                      </td>
                      <td className="border-b border-[hsl(20_8%_14%_/_0.06)] py-[0.55rem] text-v6-graphite-2">
                        {b}
                      </td>
                      <td
                        className="font-mono-v6 border-b border-[hsl(20_8%_14%_/_0.06)] py-[0.55rem] text-right text-v6-graphite-2"
                        style={{ fontFeatureSettings: '"tnum"' }}
                      >
                        {c}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs italic leading-[1.5] text-v6-graphite-3">
                Mira credits: image = 1 credit · short video = 10 · avatar video = 20 · HD video =
                50. Hard cap with a buy-more prompt at 100% — never a surprise bill. Credits
                don&rsquo;t roll over.
              </p>
            </div>
          </details>

          <p className="font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
            Not sure where to start?{" "}
            <a
              href="#alex"
              className="ml-[0.4rem] border-b border-v6-graphite-3 pb-[0.1rem] text-v6-graphite hover:border-v6-graphite"
            >
              We recommend Alex →
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
