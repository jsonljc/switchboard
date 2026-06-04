import type { Metadata } from "next";
import {
  Inter,
  DM_Sans,
  Space_Mono,
  Source_Serif_4,
  JetBrains_Mono,
  Hanken_Grotesk,
  Fraunces,
} from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import Script from "next/script";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

// Editorial register fonts — used by Alex Home / Decision Card / Reports.
// /reports consumes these via Mercury aliases declared in globals.css.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

// 600 is loaded because governed CSS declares mono SemiBold on the Results
// value family and the week-note signature; without the real cut the browser
// synthesizes a faux-bold (TY3 mono-weight guard enforces the pairing).
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-editorial",
  display: "swap",
});

// Home "warm operational editorial" register (P1-A): Hanken Grotesk UI sans +
// the Fraunces display serif below. Scoped to Home via the --font-home-*
// stacks in globals.css; other surfaces keep Inter/Source Serif 4.
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

// Fraunces is the authed app's display face (locked aesthetic direction,
// section 4 TYPE): upright optical only, no italics. next/font self-hosts the
// files at build time, so a font-load failure degrades to the serif fallback
// stack instead of flattening to system sans. Variable font: next/font/google
// forbids a fixed `weight` array alongside `axes`; the variable weight axis
// covers every display weight, and `opsz` carries the optical sizing. SOFT and
// WONK pin at their defaults (0, 0): the sharp, non-wonky cut.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Switchboard",
  description: "Your AI team runs the business. Stay in control, without the clutter.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${dmSans.variable} ${spaceMono.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${hanken.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <body className={inter.className}>
        <QueryProvider>{children}</QueryProvider>
        {process.env.NEXT_PUBLIC_META_APP_ID && (
          <Script
            src="https://connect.facebook.net/en_US/sdk.js"
            strategy="lazyOnload"
            onLoad={() => {
              window.FB?.init({
                appId: process.env.NEXT_PUBLIC_META_APP_ID!,
                cookie: true,
                xfbml: true,
                version: "v21.0",
              });
            }}
          />
        )}
      </body>
    </html>
  );
}
