import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/providers/auth-provider";
import { QueryProvider } from "@/providers/query-provider";
import { NavBar } from "@/components/layout/nav-bar";
import { Header } from "@/components/layout/header";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Switchboard Dashboard",
  description: "Monitor and manage your AI ad agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <QueryProvider>
            <div className="min-h-screen">
              <Header />
              <NavBar />
              <main className="pb-20 md:pb-0 md:pl-60">
                <div className="max-w-4xl mx-auto p-4">
                  {children}
                </div>
              </main>
              <Toaster />
            </div>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
