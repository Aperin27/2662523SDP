import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RAT — Repo Analysis Tool",
  description: "Measure file, directory, repository, commit-set and author metrics for git repositories.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-white/80 backdrop-blur dark:border-[#30363d] dark:bg-[#0d1117]/85">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-sm">
                R
              </span>
              <span className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                RAT
                <span className="ml-1.5 font-normal text-neutral-500">· Repo Analysis Tool</span>
              </span>
            </Link>
            <span className="ml-auto hidden rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-500 sm:block dark:border-neutral-800">
              COMS3011A
            </span>
          </div>
        </header>
        {children}
        <footer className="mx-auto max-w-6xl px-6 pb-8 pt-2 text-center text-xs text-neutral-400">
          COMS3011A Software Design Project · Repo Analysis Tool
        </footer>
      </body>
    </html>
  );
}
