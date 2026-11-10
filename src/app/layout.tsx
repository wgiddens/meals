import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Meals", template: "%s · Meals" },
  description: "Family recipes, the week's suppers, and the grocery list.",
};

const NAV = [
  { href: "/", label: "This week" },
  { href: "/recipes", label: "Recipes" },
  { href: "/plan", label: "Plan" },
  { href: "/grocery", label: "Groceries" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white">
          <nav className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-4 py-3 whitespace-nowrap">
            <Link href="/" className="mr-4 text-lg font-semibold tracking-tight">
              🍽️ Meals
            </Link>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
        <footer className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-stone-400">
          <span>
            Ask Claude, ChatGPT or Gemini &ldquo;what&rsquo;s for supper?&rdquo; once they&rsquo;re connected to
            this app. See the README.
          </span>
          <span className="flex gap-3">
            <Link href="/family" className="underline hover:text-stone-600">
              Family
            </Link>
            <Link href="/account" className="underline hover:text-stone-600">
              My account
            </Link>
          </span>
        </footer>
      </body>
    </html>
  );
}
