import { Reveal } from "./reveal";

const FLOW = [
  {
    key: "alex",
    name: "Alex",
    line: "tells Nova",
    payload: "which audiences converted",
  },
  {
    key: "nova",
    name: "Nova",
    line: "tells Mira",
    payload: "which angles to retire",
  },
  {
    key: "mira",
    name: "Mira",
    line: "tells Alex",
    payload: "how to talk about it",
  },
];

export function V6Synergy() {
  return (
    <section
      id="synergy"
      data-screen-label="02 Synergy"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-20 max-[900px]:py-16"
    >
      <div className="v6-beat-frame">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-10 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
          <span className="inline-flex items-center gap-[0.6rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
            <span>02 — One memory</span>
          </span>
          <span>The desk / synergy</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="mx-auto flex max-w-[64rem] flex-col items-center text-center">
          <Reveal
            as="h2"
            className="mb-12 font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
            style={{ fontSize: "clamp(2rem, 4.4vw, 3.5rem)" }}
          >
            They&rsquo;re better{" "}
            <em className="v6-synergy-accent relative inline-block font-semibold not-italic text-v6-coral">
              together
            </em>
            .
          </Reveal>

          <div className="grid w-full grid-cols-1 items-center gap-x-20 gap-y-12 text-left md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Reveal
              as="p"
              className="max-w-[30rem] text-[1.125rem] leading-[1.55] text-v6-graphite-2"
            >
              Built so each agent&rsquo;s signal can flow to the others — what Alex hears in chat,
              what Nova sees in spend, what Mira learns from creative reviews.{" "}
              <b className="font-medium text-v6-graphite">The desk shares context as it grows.</b>
            </Reveal>

            <Reveal
              as="ol"
              aria-label="What the three agents share"
              className="m-0 flex w-full max-w-[30rem] list-none flex-col gap-[1.1rem] border-t border-[hsl(20_8%_14%_/_0.12)] pt-6"
            >
              {FLOW.map((it) => (
                <li
                  key={it.key}
                  className="grid grid-cols-[42px_auto_1fr] items-baseline gap-x-[0.85rem] gap-y-[0.15rem] py-[0.2rem]"
                >
                  <span className="row-span-2 flex h-[34px] w-[34px] items-center justify-center self-center rounded-full border border-[hsl(20_8%_14%_/_0.12)] bg-white text-v6-graphite">
                    <svg viewBox="0 0 48 48" className="block h-[18px] w-[18px]">
                      <use href={`#mark-${it.key}`} />
                    </svg>
                  </span>
                  <span
                    className="text-[1.5rem] font-normal leading-none tracking-[-0.015em] text-v6-graphite"
                    style={{ fontFamily: "Georgia, ui-serif, serif", fontStyle: "italic" }}
                  >
                    {it.name}
                  </span>
                  <span className="font-mono-v6 whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
                    {it.line}
                  </span>
                  <span
                    className="col-span-full col-start-2 text-base italic leading-[1.35] text-v6-graphite-2"
                    style={{ fontFamily: "Georgia, ui-serif, serif" }}
                  >
                    {it.payload}
                  </span>
                </li>
              ))}
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
