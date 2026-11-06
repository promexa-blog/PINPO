import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sans = localFont({
  src: "../../assets/fonts/NotoSans.ttf",
  variable: "--font-pinpo",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PINPO — DemandMesh Ad Studio",
  description: "Local AI advertisement production studio for DemandMesh",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-dvh bg-dm-bg text-dm-primary">{children}</body>
    </html>
  );
}
