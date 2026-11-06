import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { StudioHeader } from "./_components/header";
import "./globals.css";

const sans = localFont({
  src: "../../assets/fonts/NotoSans.ttf",
  variable: "--font-pinpo",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "PINPO Ad Studio", template: "%s · PINPO" },
  description: "Make short video ads from a product photo and a brief.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("pinpo-theme")?.value;
  return (
    <html lang="en" className={sans.variable} data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only z-50 rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-3">
          Skip to content
        </a>
        <StudioHeader />
        {children}
      </body>
    </html>
  );
}
