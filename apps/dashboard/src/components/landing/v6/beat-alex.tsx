import { ArrowSig } from "./glyphs";
import { Reveal } from "./reveal";

type Msg =
  | { kind: "stamp"; text: string }
  | { kind: "lead"; text: string; time: string }
  | { kind: "alex"; text: string; time: string }
  | { kind: "booking"; title: string; meta: string; label: string };

const THREAD: Msg[] = [
  { kind: "stamp", text: "Tuesday · 2:47 AM" },
  { kind: "lead", text: "hi! do you do whitening? saw your reel", time: "2:47" },
  {
    kind: "alex",
    text: "Hi Marisol — yes, we do. First session is $99 with a senior hygienist. Are you in CDMX?",
    time: "2:47",
  },
  { kind: "lead", text: "yes condesa. how long does it take", time: "2:48" },
  {
    kind: "alex",
    text: "About 50 minutes, no pain. We use a low-sensitivity gel. Want to peek at this week or next?",
    time: "2:48",
  },
  { kind: "lead", text: "next week morning", time: "2:48" },
  { kind: "alex", text: "I have Tue 10am, Wed 9am, Thu 11am. Which works?", time: "2:48" },
  { kind: "lead", text: "tue 10", time: "2:49" },
  {
    kind: "booking",
    title: "Whitening · 50 min",
    meta: "Tue 10:00am · Aurora Dental, Condesa",
    label: "Booked",
  },
  {
    kind: "alex",
    text: "Locked in. I just sent the calendar invite + a 1-min prep note. Anything else?",
    time: "2:49",
  },
  { kind: "lead", text: "no thats perfect 🙏", time: "2:49" },
];

export function V6BeatAlex() {
  return (
    <section
      id="alex"
      data-screen-label="03 Alex"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-32 max-[900px]:py-20"
    >
      <div className="v6-beat-frame">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-10 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
          <span className="inline-flex items-center gap-[0.6rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
            <span>03 — Lead response</span>
          </span>
          <span>a 01 / · alex · lead reply</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="grid items-center gap-x-20 gap-y-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] max-[900px]:grid-cols-1 max-[900px]:gap-10">
          <Reveal className="flex max-w-[30rem] flex-col gap-[1.4rem]">
            <span className="font-mono-v6 inline-flex items-center gap-[0.55rem] text-[11px] font-medium uppercase tracking-[0.06em] text-v6-graphite-3">
              <span className="inline-flex h-[1.1rem] w-[1.1rem] items-center justify-center">
                <svg viewBox="0 0 48 48" className="h-full w-full">
                  <use href="#mark-alex" />
                </svg>
              </span>
              a 01 — Alex · lead reply
            </span>
            <h2
              className="text-balance font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
              style={{ fontSize: "clamp(2rem, 3.8vw, 3.5rem)" }}
            >
              <span className="block font-normal text-v6-graphite-2">
                Leads die in twelve <em className="font-semibold not-italic">minutes</em>.
              </span>
              <span className="block font-semibold text-v6-graphite">
                Alex replies in twelve{" "}
                <em className="font-semibold not-italic text-v6-coral">seconds</em>.
              </span>
            </h2>
            <p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
              Across WhatsApp, Telegram, and your site.{" "}
              <b className="font-medium text-v6-graphite">Sleeps zero.</b> Qualifies through natural
              conversation, books to your real calendar, hands off the ones that need a human.
            </p>
            <ul className="grid w-full grid-cols-1 gap-[0.85rem] border-t border-[hsl(20_8%_14%_/_0.12)] pt-6">
              {[
                "12-second median first reply",
                "Qualifies through natural conversation",
                "Books to your real calendar",
                "Handoff path you control",
              ].map((b, i) => (
                <li
                  key={i}
                  className="relative pl-[1.05rem] text-[0.95rem] leading-[1.4] text-v6-graphite before:absolute before:left-0 before:top-[0.55rem] before:h-[5px] before:w-[5px] before:rounded-full before:bg-v6-graphite-4 before:content-['']"
                >
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <a
                href="#pricing"
                className="inline-flex items-center gap-[0.4rem] border-b border-[hsl(20_8%_14%_/_0.12)] pb-[0.2rem] text-[0.95rem] font-medium text-v6-graphite transition-colors hover:border-v6-graphite"
              >
                Start with Alex
                <ArrowSig className="!h-[0.55rem] !w-[0.9rem]" />
              </a>
            </div>
          </Reveal>

          <Reveal>
            <PhoneFrame thread={THREAD} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function PhoneFrame({ thread }: { thread: Msg[] }) {
  return (
    <div
      className="relative mx-auto w-full max-w-[320px]"
      aria-label="A WhatsApp conversation with Alex"
    >
      <div className="relative flex aspect-[9/19.5] rounded-[2.5rem] bg-[#0d0c0b] p-2 shadow-[0_24px_60px_hsl(20_30%_30%_/_0.14),0_4px_14px_hsl(20_30%_30%_/_0.08),inset_0_0_0_1px_hsl(0_0%_100%_/_0.04)]">
        <div className="absolute left-1/2 top-[0.8rem] z-[2] h-[1.35rem] w-[5.25rem] -translate-x-1/2 rounded-full bg-black" />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] bg-[#ECE4DC]">
          {/* Header */}
          <header className="flex items-center gap-[0.6rem] border-b border-[hsl(20_8%_14%_/_0.1)] bg-[#EFE7DF] px-[0.9rem] pt-[2.6rem] pb-[0.65rem] text-sm">
            <span className="text-[1.2rem] font-light text-v6-graphite-2">‹</span>
            <span className="flex h-[2.1rem] w-[2.1rem] items-center justify-center rounded-full bg-gradient-to-br from-[hsl(14_70%_60%)] to-[hsl(28_55%_65%)] text-sm font-semibold text-white">
              M
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="text-sm font-medium text-v6-graphite">
                Marisol · whitening enquiry
              </span>
              <span className="text-[11px] text-v6-coral">typing…</span>
            </span>
            <span aria-hidden="true" className="text-base opacity-60">
              📞
            </span>
          </header>

          {/* Thread */}
          <div className="v6-wa-thread flex flex-1 flex-col gap-[0.45rem] overflow-y-auto overflow-x-hidden px-[0.85rem] py-4">
            {thread.map((m, i) => {
              if (m.kind === "stamp") {
                return (
                  <div
                    key={i}
                    className="font-mono-v6 my-[0.4rem] self-center rounded-[0.4rem] bg-[hsl(28_30%_90%_/_0.8)] px-[0.55rem] py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3"
                  >
                    {m.text}
                  </div>
                );
              }
              if (m.kind === "booking") {
                return (
                  <div
                    key={i}
                    className="flex max-w-[80%] flex-col gap-[0.35rem] self-end rounded-[0.7rem] rounded-tr-[0.2rem] border-l-2 border-v6-coral bg-white p-[0.6rem_0.7rem] shadow-[0_1px_1px_hsl(20_8%_14%_/_0.06)]"
                  >
                    <span className="font-mono-v6 inline-flex items-center gap-[0.4rem] text-[10.5px] font-medium uppercase tracking-[0.06em] text-v6-coral before:h-[5px] before:w-[5px] before:rounded-full before:bg-v6-coral before:content-['']">
                      {m.label}
                    </span>
                    <span className="text-sm font-medium text-v6-graphite">{m.title}</span>
                    <span className="font-mono-v6 text-[11.5px] tracking-[0.02em] text-v6-graphite-2">
                      {m.meta}
                    </span>
                  </div>
                );
              }
              const cls = m.kind === "alex" ? "alex" : "lead";
              return (
                <div
                  key={i}
                  className={`v6-wa-bubble ${cls} flex max-w-[78%] flex-col gap-[0.15rem] rounded-[0.7rem] px-[0.7rem] pb-[0.35rem] pt-2 text-sm leading-[1.35] text-v6-graphite shadow-[0_1px_1px_hsl(20_8%_14%_/_0.06)] ${
                    m.kind === "alex"
                      ? "self-end rounded-tr-[0.2rem] bg-[#D9F0DC]"
                      : "self-start rounded-tl-[0.2rem] bg-white"
                  }`}
                >
                  <span>{m.text}</span>
                  <span className="font-mono-v6 v6-wa-time self-end text-[9.5px] tracking-[0.04em] text-v6-graphite-3">
                    {m.time}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Input */}
          <footer className="border-t border-[hsl(20_8%_14%_/_0.08)] bg-[#EFE7DF] px-[0.85rem] pb-[0.9rem] pt-[0.7rem]">
            <span className="flex items-center rounded-full bg-white px-4 py-[0.55rem] text-[0.8125rem] text-v6-graphite-3 shadow-[0_1px_1px_hsl(20_8%_14%_/_0.06)]">
              Message
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
