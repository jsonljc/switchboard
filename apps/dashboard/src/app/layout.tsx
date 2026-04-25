import type { Metadata } from "next";
import { Inter, DM_Sans, Space_Mono } from "next/font/google";
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
      className={`${inter.variable} ${dmSans.variable} ${spaceMono.variable}`}
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
