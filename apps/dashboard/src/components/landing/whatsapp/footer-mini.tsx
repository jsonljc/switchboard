export function WhatsAppFooterMini() {
  return (
    <footer className="border-t border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-3 py-12">
      <div className="font-mono-v6 mx-auto flex max-w-[80rem] items-center justify-between gap-6 px-10 max-[900px]:flex-col max-[900px]:items-start max-[900px]:gap-3 max-[900px]:px-6">
        <span className="text-[10px] uppercase tracking-[0.08em] text-v6-graphite-3">
          © 2026 Switchboard, Inc. · 548 Market Street, PMB 41218
        </span>
        <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-v6-graphite-3">
          <span className="inline-block h-[6px] w-[6px] animate-v6-pulse-soft rounded-full bg-[hsl(140_50%_40%)]" />
          Cloud API live
        </span>
      </div>
    </footer>
  );
}
