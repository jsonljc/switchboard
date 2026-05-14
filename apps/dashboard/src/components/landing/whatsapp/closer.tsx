import { ArrowSig } from "../v6/glyphs";
import { BeatFrame } from "./beat-frame";

export function WhatsAppCloser() {
  return (
    <section
      id="waitlist"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-28 text-center max-[900px]:py-20"
    >
      <BeatFrame left="05 — One next step" right="join the waitlist" />

      <div className="mx-auto max-w-[48rem] px-10 max-[900px]:px-6">
        <h2
          className="font-medium leading-[1.05] tracking-[-0.022em] text-v6-graphite"
          style={{ fontSize: "clamp(2.25rem, 5vw, 3.75rem)" }}
        >
          Hire <em className="font-semibold not-italic">Alex</em>.
          <br />
          Inside WhatsApp Business.
        </h2>
        <p className="mt-6 text-[1.0625rem] text-v6-graphite-2">
          Early access opens to operators on Cloud API in Q3. One seat to start.
        </p>
        <div className="mt-9">
          <a
            href="#"
            className="inline-flex items-center gap-[0.65rem] whitespace-nowrap rounded-full bg-v6-graphite px-7 py-[1.05rem] text-[0.95rem] font-medium text-v6-cream shadow-[0_1px_0_hsl(20_12%_4%_/_0.15)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-px hover:bg-black hover:shadow-[0_8px_24px_hsl(20_12%_4%_/_0.18)]"
          >
            Join the waitlist
            <ArrowSig />
          </a>
        </div>
      </div>
    </section>
  );
}
