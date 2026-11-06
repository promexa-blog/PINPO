import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { StudioHeader } from "./_components/header";
import { FeedbackProvider } from "./_components/feedback";
import "./globals.css";

/**
 * Studio interface face (Latin, 47 KB woff2, preloaded). Glyphs it lacks (₹, Malayalam,
 * Devanagari) come from small unicode-range Noto faces in globals.css, fetched only when used.
 * OFL 1.1.
 */
const instrumentSans = localFont({
  src: "../../assets/fonts/web/InstrumentSans.woff2",
  variable: "--font-ui",
  weight: "400 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "PINPO Ad Studio", template: "%s · PINPO" },
  description: "Make short video ads from a product photo and a brief.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("pinpo-theme")?.value;
  return (
    <html lang="en" className={instrumentSans.variable} data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only z-50 rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-3">
          Skip to content
        </a>
        <FeedbackProvider>
          <StudioHeader />
          {children}
        </FeedbackProvider>
      </body>
    </html>
  );
}
