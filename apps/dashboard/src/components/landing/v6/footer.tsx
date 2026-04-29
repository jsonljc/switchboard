export function V6Footer() {
  return (
    <footer
      data-screen-label="09 Footer"
      className="border-t border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-3 px-0 py-20 text-v6-graphite-2 max-[900px]:py-14"
    >
      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="mb-16 grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-12 max-[900px]:grid-cols-2 max-[900px]:gap-10">
          <div className="flex max-w-[18rem] flex-col gap-4">
            <span className="inline-flex items-center gap-[0.55rem] text-[1.0625rem] font-semibold tracking-[-0.014em] text-v6-graphite">
              <span
                aria-hidden="true"
                className="v6-wordmark-dot relative h-[0.55rem] w-[0.55rem] rounded-full bg-v6-graphite"
              />
              Switchboard
            </span>
            <span className="text-[0.8125rem] leading-[1.5] text-v6-graphite-2">
              Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira
              ships creative. They share what they learn.
            </span>
          </div>

          <FooterCol heading="The desk">
            <a href="#alex">Alex · lead reply</a>
            <a href="#nova">Nova · ad optimizer</a>
            <a href="#mira">Mira · creative</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
          </FooterCol>

          <FooterCol heading="Company">
            <a href="#">Contact</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="#">Data &amp; security</a>
          </FooterCol>

          <FooterCol heading="Status">
            <a href="#" className="inline-flex items-center gap-[0.5rem]">
              <span className="v6-footer-pulse" />
              All systems normal
            </a>
            <a href="#">status.switchboard.live</a>
            <a href="#">@switchboard</a>
          </FooterCol>
        </div>

        <div className="font-mono-v6 flex items-center justify-between gap-8 border-t border-[hsl(20_8%_14%_/_0.12)] pt-8 text-[10px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-4">
          <span>© 2026 Switchboard, Inc.</span>
          <span>Built for the businesses that don&rsquo;t sleep.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-mono-v6 mb-5 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
        {heading}
      </h4>
      <ul className="flex flex-col gap-[0.65rem] text-[0.875rem] text-v6-graphite-2 [&_a]:transition-colors [&_a:hover]:text-v6-graphite">
        {Array.isArray(children) ? (
          children.map((child, i) => <li key={i}>{child}</li>)
        ) : (
          <li>{children}</li>
        )}
      </ul>
    </div>
  );
}
