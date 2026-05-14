import { BeatFrame } from "./beat-frame";

type BubbleSide = "lead" | "alex";

function Bubble({ side, text, time }: { side: BubbleSide; text: string; time: string }) {
  const isAlex = side === "alex";
  return (
    <div
      className={`v6-wa-bubble ${isAlex ? "alex self-end" : "lead self-start"} flex max-w-[88%] flex-col gap-[0.15rem] rounded-[0.7rem] px-[0.7rem] pb-[0.35rem] pt-2 text-sm leading-[1.35] text-v6-graphite shadow-[0_1px_1px_hsl(20_8%_14%_/_0.06)] ${
        isAlex
          ? "rounded-tr-[0.2rem] [background:#D9F0DC]"
          : "rounded-tl-[0.2rem] [background:#FFFFFF]"
      }`}
    >
      <span>{text}</span>
      <span className="font-mono-v6 v6-wa-time self-end text-[9.5px] tracking-[0.04em] text-v6-graphite-3">
        {time}
      </span>
    </div>
  );
}

function BubbleRow({ side, text }: { side: BubbleSide; text: string }) {
  return (
    <div className="v6-wa-thread flex w-full max-w-[380px] flex-col gap-[0.4rem] rounded-[0.6rem] p-4">
      <Bubble side={side} text={text} time="2:47" />
    </div>
  );
}

function ContextCard() {
  const rows: Array<[string, string]> = [
    ["past_threads", "12 with marisol.r — last 7 days"],
    ["status", "lead · whitening enquiry · cold"],
    ["session_window", "open · 23h 58m remaining"],
    ["playbook", "aurora-dental / whitening / v3"],
    ["calendar", "Tue 10:00, Wed 09:00, Thu 11:00 free"],
  ];
  return (
    <div className="w-full max-w-[360px] rounded-[0.6rem] border border-[hsl(20_8%_14%_/_0.12)] bg-white px-[1.15rem] py-4">
      <div className="font-mono-v6 mb-[0.65rem] text-[10.5px] uppercase tracking-[0.1em] text-v6-graphite-3">
        Alex / context loaded
      </div>
      <div className="font-mono-v6 text-[0.78rem]">
        {rows.map(([k, v], i) => (
          <div
            key={k}
            className={`grid grid-cols-[9rem_1fr] py-[0.3rem] text-v6-graphite ${
              i === 0 ? "" : "border-t border-[hsl(20_8%_14%_/_0.06)]"
            }`}
          >
            <span className="text-v6-graphite-3">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplateBubble() {
  return (
    <div className="v6-wa-thread flex w-full max-w-[380px] flex-col gap-[0.4rem] rounded-[0.6rem] p-4">
      <div className="font-mono-v6 self-center rounded-[0.4rem] bg-[hsl(28_30%_90%_/_0.8)] px-[9px] py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
        26h later · outside window
      </div>
      <div className="v6-wa-bubble flex max-w-[88%] flex-col gap-[0.3rem] self-end rounded-[0.7rem] rounded-tr-[0.2rem] border-l-2 border-v6-coral bg-white px-[0.7rem] pb-[0.35rem] pt-2 text-sm leading-[1.35] text-v6-graphite shadow-[0_1px_1px_hsl(20_8%_14%_/_0.06)]">
        <span className="font-mono-v6 inline-flex items-center gap-[0.4rem] text-[10.5px] font-medium uppercase tracking-[0.06em] text-v6-coral">
          <span className="inline-block h-[5px] w-[5px] rounded-full bg-v6-coral" />
          Approved template · appt_reminder
        </span>
        <span className="block">
          Hi Marisol — your whitening appt is Tue 10:00am at Aurora Dental, Condesa. Reply YES to
          confirm.
        </span>
      </div>
    </div>
  );
}

function HoldBubble() {
  return (
    <div className="w-full max-w-[380px] rounded-[0.6rem] border border-[hsl(20_8%_14%_/_0.12)] bg-white px-[1.15rem] py-4">
      <div className="font-mono-v6 mb-[0.65rem] inline-flex items-center gap-[0.45rem] text-[10.5px] uppercase tracking-[0.1em] text-v6-coral">
        <span className="inline-block h-[5px] w-[5px] rounded-full bg-v6-coral" />
        Held for approval · refund_request
      </div>
      <div className="mb-[0.65rem] text-[0.9rem] text-v6-graphite">
        Draft:{" "}
        <em className="font-semibold not-italic text-v6-graphite">
          &ldquo;I can refund the deposit on this booking — confirming with our scheduler now. Back
          to you within the hour.&rdquo;
        </em>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-full border-none bg-v6-graphite px-3 py-[0.4rem] text-[0.8rem] text-v6-cream"
        >
          Send draft
        </button>
        <button
          type="button"
          className="rounded-full border border-[hsl(20_8%_14%_/_0.12)] bg-transparent px-3 py-[0.4rem] text-[0.8rem] text-v6-graphite"
        >
          Edit
        </button>
        <button
          type="button"
          className="rounded-full border border-[hsl(20_8%_14%_/_0.12)] bg-transparent px-3 py-[0.4rem] text-[0.8rem] text-v6-graphite-2"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

type StoryStep = {
  num: string;
  stamp: string;
  title: React.ReactNode;
  body: string;
  visual: React.ReactNode;
};

const STEPS: StoryStep[] = [
  {
    num: "01",
    stamp: "0s — inbound",
    title: "A lead messages your number.",
    body: "Their first ping lands on Switchboard's WhatsApp Cloud API connection. The 24-hour session window starts ticking.",
    visual: <BubbleRow side="lead" text="hi! do you do whitening? saw your reel" />,
  },
  {
    num: "02",
    stamp: "2–4s — read context",
    title: (
      <>
        <em className="font-semibold not-italic">Alex</em> reads the context.
      </>
    ),
    body: "Past threads with this contact, your business hours, the open booking pipeline, and the playbook you wrote — all in scope.",
    visual: <ContextCard />,
  },
  {
    num: "03",
    stamp: "5s — free-form reply",
    title: "Inside the window: free-form.",
    body: "Alex drafts in your voice and sends — no template needed. Read receipts come back as ✓✓ in seconds.",
    visual: (
      <BubbleRow
        side="alex"
        text="Hi Marisol — yes, we do. First session is $99 with a senior hygienist. Are you in CDMX?"
      />
    ),
  },
  {
    num: "04",
    stamp: "26h later — outside window",
    title: "Outside the window: approved template.",
    body: "The session closed overnight. Alex re-opens it with an approved utility template; once she replies, free-form resumes.",
    visual: <TemplateBubble />,
  },
  {
    num: "05",
    stamp: "anytime — risky",
    title: "Operator approves anything risky.",
    body: "Discount asks, refund requests, off-policy answers — Alex pauses, drafts the reply, and waits for a human click.",
    visual: <HoldBubble />,
  },
];

export function WhatsAppStoryRail() {
  return (
    <section className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-28 max-[900px]:py-20">
      <BeatFrame left="02 — How it works with Alex" right="session · template · handoff" />

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="mb-16 flex flex-wrap items-end justify-between gap-12 border-b border-[hsl(20_8%_14%_/_0.12)] pb-10">
          <h2
            className="max-w-[18ch] font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
            style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
          >
            One inbound message. <em className="font-semibold not-italic">Four moves</em> from Alex.
          </h2>
          <p className="max-w-[22rem] text-v6-graphite-2">
            Inside the 24-hour session window Alex replies in your voice. Past it, Alex queues an
            approved template. Risky asks pause for the operator.
          </p>
        </div>

        <div className="flex flex-col">
          {STEPS.map((s, i) => (
            <div
              key={s.num}
              className={`grid grid-cols-[5rem_minmax(0,1.05fr)_minmax(0,1fr)] items-start gap-12 border-b border-[hsl(20_8%_14%_/_0.12)] py-10 max-[900px]:grid-cols-1 max-[900px]:gap-6 ${
                i === 0 ? "border-t border-[hsl(20_8%_14%_/_0.12)]" : ""
              }`}
            >
              <span className="font-mono-v6 pt-[0.4rem] text-[11px] uppercase tracking-[0.08em] text-v6-graphite-3">
                /{s.num}/
              </span>
              <div>
                <div className="font-mono-v6 mb-[0.65rem] text-[11px] uppercase tracking-[0.08em] text-v6-coral">
                  {s.stamp}
                </div>
                <h3 className="text-[1.5rem] font-medium leading-[1.15] tracking-[-0.012em] text-v6-graphite">
                  {s.title}
                </h3>
                <p className="mt-[0.85rem] max-w-[30rem] text-v6-graphite-2">{s.body}</p>
              </div>
              <div className="flex justify-start">{s.visual}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
