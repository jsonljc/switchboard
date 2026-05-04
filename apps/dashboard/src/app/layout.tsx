import type { Metadata } from "next";
import { Inter, DM_Sans, Space_Mono, Source_Serif_4, JetBrains_Mono } from "next/font/google";
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

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-editorial",
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
      className={`${inter.variable} ${dmSans.variable} ${spaceMono.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
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
