import { ArrowSig } from "../v6/glyphs";
import { BeatFrame } from "./beat-frame";

export function WhatsAppHero() {
  return (
    <section
      id="whatsapp-hero"
      className="v6-hero-bg relative overflow-hidden px-0 pb-24 pt-36 text-center max-[900px]:pb-16 max-[900px]:pt-28"
    >
      <BeatFrame left="01 — WhatsApp Business" right="Switchboard / Tech Provider" />

      <div className="relative mx-auto max-w-[60rem] px-10 max-[900px]:px-6">
        <span className="v6-hero-eyebrow font-mono-v6 inline-flex items-center gap-[0.6rem] text-[11px] tracking-[0.1em] text-v6-graphite-3">
          A 01 — Alex on WhatsApp Business
        </span>

        <h1
          className="mx-auto mt-7 max-w-[18ch] text-balance font-semibold leading-[1.0] tracking-[-0.025em] text-v6-graphite"
          style={{ fontSize: "clamp(2.6rem, 6.4vw, 5.6rem)" }}
        >
          WhatsApp Business —{" "}
          <em className="font-semibold not-italic text-v6-coral">managed by Alex</em>.
        </h1>

        <p className="mx-auto mt-7 max-w-[36rem] text-[1.125rem] leading-[1.5] text-v6-graphite-2">
          Switchboard is your WhatsApp Business Platform layer — numbers, templates, quality, audit.{" "}
          <em className="font-semibold not-italic text-v6-graphite">Alex</em> is the AI reply agent
          on top, drafting answers inside the 24-hour session window and escalating when it&apos;s
          risky.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-6">
          <a
            href="#waitlist"
            className="inline-flex items-center gap-[0.65rem] whitespace-nowrap rounded-full bg-v6-graphite px-7 py-[1.05rem] text-[0.95rem] font-medium text-v6-cream shadow-[0_1px_0_hsl(20_12%_4%_/_0.15)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-px hover:bg-black hover:shadow-[0_8px_24px_hsl(20_12%_4%_/_0.18)]"
          >
            Join the waitlist
            <ArrowSig />
          </a>
        </div>

        <span className="font-mono-v6 mt-11 inline-block text-[11px] tracking-[0.08em] text-v6-graphite-3">
          Tech Provider · WABA · End-to-end encrypted · You hold the keys
        </span>
      </div>
    </section>
  );
}
