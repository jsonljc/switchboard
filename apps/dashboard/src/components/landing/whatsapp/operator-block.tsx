import Link from "next/link";
import { BeatFrame } from "./beat-frame";

const OPERATOR = {
  legalName: "Switchboard, Inc.",
  tradingAs: "Switchboard",
  addressL1: "548 Market Street, PMB 41218",
  addressL2: "San Francisco, CA 94104, USA",
  supportEmail: "wa-support@switchboard.ai",
  dpoEmail: "privacy@switchboard.ai",
};

function Field({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="font-mono-v6 mb-[0.55rem] text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
        {label}
      </div>
      <div className="text-[0.95rem] leading-[1.45] text-v6-graphite">{value}</div>
    </div>
  );
}

export function WhatsAppOperatorBlock() {
  return (
    <section className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-28 max-[900px]:py-20">
      <BeatFrame left="04 — Operator block" right="who owns this offering" />

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start gap-20 max-[900px]:grid-cols-1 max-[900px]:gap-12">
          <div>
            <h2
              className="max-w-[16ch] font-medium leading-[1.1] tracking-[-0.014em] text-v6-graphite"
              style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
            >
              A <em className="font-semibold not-italic">real</em> company, on the directory.
            </h2>
            <p className="mt-6 max-w-[30rem] text-v6-graphite-2">
              Switchboard is a Meta-listed Tech Provider for the WhatsApp Business Platform. If you
              are a Meta Business Verification reviewer arriving here from an application, you have
              the right page.
            </p>
            <p className="mt-4 max-w-[30rem] text-v6-graphite-2">
              For onboarding questions, write to{" "}
              <em className="font-semibold not-italic text-v6-graphite">{OPERATOR.supportEmail}</em>
              .
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-10 sm:grid-cols-2 md:grid-cols-4">
            <Field label="Legal entity" value={OPERATOR.legalName} />
            <Field label="Trading as" value={OPERATOR.tradingAs} />
            <Field label="Role" value="WhatsApp Tech Provider" />
            <Field label="Stack" value="WhatsApp Business Platform · Cloud API" />
            <Field
              label="Registered address"
              wide
              value={
                <>
                  <div>{OPERATOR.addressL1}</div>
                  <div>{OPERATOR.addressL2}</div>
                </>
              }
            />
            <Field label="Support" value={OPERATOR.supportEmail} />
            <Field label="Data protection" value={OPERATOR.dpoEmail} />
            <Field
              label="Policies"
              value={
                <>
                  <Link href="/privacy" className="underline-offset-2 hover:underline">
                    Privacy
                  </Link>
                  {" · "}
                  <Link href="/terms" className="underline-offset-2 hover:underline">
                    Terms
                  </Link>
                </>
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
