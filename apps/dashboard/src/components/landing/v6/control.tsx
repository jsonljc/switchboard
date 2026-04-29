"use client";

import { useState } from "react";

interface Item {
  num: string;
  title: string;
  detail: string;
}

const ITEMS: Item[] = [
  {
    num: "/01/",
    title: "Approval-first",
    detail:
      "Every action can start supervised — you see the draft, you click send. Loosen specific actions to autonomous when you trust the pattern. No agent ever publishes ads, posts creative, or moves money on its own.",
  },
  {
    num: "/02/",
    title: "Audited",
    detail:
      "Every reply, every ad-set change, every draft — logged with timestamp, agent, and reasoning. Exportable. Searchable. Your auditor will love it.",
  },
  {
    num: "/03/",
    title: "Where your work lives",
    detail:
      "Connects to the tools you already pay for: WhatsApp Business, Meta Ads, Google Calendar, Cal.com, Notion. We don't ask you to migrate. Disconnect with one click.",
  },
  {
    num: "/04/",
    title: "Hands-off when ready",
    detail:
      "Once a workflow is proven — Alex's first replies, Nova's pause-on-CPL — graduate it to autonomous in one toggle. Revoke just as fast. You decide the leash, per agent, per action.",
  },
];

export function V6Control() {
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <section
      id="how"
      data-screen-label="06 Control"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-28 max-[900px]:py-20"
    >
      <div className="v6-beat-frame">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-10 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
          <span className="inline-flex items-center gap-[0.6rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
            <span>06 — Stays yours</span>
          </span>
          <span>Control / safety</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="mb-14 flex items-end justify-between gap-12 border-b border-[hsl(20_8%_14%_/_0.12)] pb-10 max-[900px]:flex-col max-[900px]:items-start max-[900px]:gap-6">
          <h2
            className="max-w-[18ch] font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
            style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
          >
            Built so you stay <em className="font-semibold not-italic">in&nbsp;control</em>. Always.
          </h2>
          <p className="max-w-[22rem] text-base leading-[1.5] text-v6-graphite-2">
            Every agent runs through the same controls. Approval-first by default. You loosen the
            leash on your own time, not ours.
          </p>
        </div>

        <div className="flex flex-col">
          {ITEMS.map((it, i) => {
            const isOpen = openIdx === i;
            return (
              <div
                key={it.num}
                className={`v6-ability ${isOpen ? "open" : ""} grid cursor-pointer grid-cols-[5rem_1fr_1.5rem] items-start gap-8 border-b border-[hsl(20_8%_14%_/_0.12)] py-8 transition-colors hover:bg-[hsl(20_8%_14%_/_0.015)] max-[640px]:grid-cols-[3rem_1fr_1.25rem] max-[640px]:gap-4 max-[640px]:py-6 ${
                  i === 0 ? "border-t border-t-[hsl(20_8%_14%_/_0.12)]" : ""
                }`}
                onClick={() => setOpenIdx(isOpen ? -1 : i)}
              >
                <span className="font-mono-v6 pt-[0.55rem] text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
                  {it.num}
                </span>
                <div className="flex min-w-0 flex-col gap-3">
                  <h3
                    className="font-medium leading-[1.2] tracking-[-0.012em] text-v6-graphite"
                    style={{ fontSize: "clamp(1.25rem, 2vw, 1.625rem)" }}
                  >
                    {it.title}
                  </h3>
                  <div className="v6-ability-detail text-base leading-[1.5] text-v6-graphite-2">
                    {it.detail}
                  </div>
                </div>
                <span
                  className={`v6-ability-toggle mt-1 flex h-6 w-6 items-center justify-center text-v6-graphite-3 transition-transform duration-[350ms]`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14">
                    <path
                      d="M7 1 V13 M1 7 H13"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
