import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import Nav from "./components/nav";

const sans = Archivo({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "NQ Trade Mentor",
  description: "Trade reviews en journaling volgens de methode",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="nl" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans min-h-screen grid-bg">
        <header className="border-b border-edge bg-ink/85 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-3xl px-4 h-14 flex items-center justify-between">
            <Link href={user ? "/review" : "/"} className="flex items-center gap-2">
              <span className="font-mono text-session text-sm font-bold tracking-tight border border-session/40 rounded px-1.5 py-0.5">
                NQ
              </span>
              <span className="font-semibold tracking-tight">Trade Mentor</span>
            </Link>
            {user && <Nav />}
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8 pb-24">{children}</main>
      </body>
    </html>
  );
}
