"use client";

import { useEffect, useState } from "react";
import { ArrowSig } from "./glyphs";

export function V6Topbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 py-5 transition-[background-color,border-color] duration-300 ${
        scrolled
          ? "border-b border-[hsl(20_8%_14%_/_0.06)] backdrop-blur-[14px] [background:hsl(28_30%_90%_/_0.82)] [-webkit-backdrop-filter:blur(14px)_saturate(140%)] [backdrop-filter:blur(14px)_saturate(140%)]"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-[80rem] items-center justify-between px-10 max-[900px]:px-6">
        <a
          href="#hero"
          aria-label="Switchboard, home"
          className="inline-flex items-center gap-[0.55rem] text-[1.0625rem] font-semibold tracking-[-0.014em] text-v6-graphite"
        >
          <span
            aria-hidden="true"
            className="v6-wordmark-dot relative h-[0.55rem] w-[0.55rem] rounded-full bg-v6-graphite"
          />
          <span>Switchboard</span>
        </a>

        <nav aria-label="primary" className="flex flex-nowrap items-center gap-6 max-[640px]:gap-4">
          <a
            href="#how"
            className="whitespace-nowrap text-sm font-medium text-v6-graphite-2 transition-colors hover:text-v6-graphite max-[640px]:hidden"
          >
            How it works
          </a>
          <a
            href="#pricing"
            className="whitespace-nowrap text-sm font-medium text-v6-graphite-2 transition-colors hover:text-v6-graphite"
          >
            Pricing
          </a>
          <a
            href="/login"
            aria-label="Sign in"
            className="whitespace-nowrap text-sm font-medium text-v6-graphite-2 transition-colors hover:text-v6-graphite max-[640px]:hidden"
          >
            Sign in
          </a>
          <a
            href="#closer"
            className="inline-flex items-center gap-[0.45rem] whitespace-nowrap rounded-full bg-v6-graphite px-4 py-[0.55rem] text-[0.8125rem] font-medium text-v6-cream transition-[transform,background-color] duration-200 hover:-translate-y-px hover:bg-black"
          >
            Get started
            <ArrowSig />
          </a>
        </nav>
      </div>
    </header>
  );
}
