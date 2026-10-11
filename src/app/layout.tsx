import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { APP_NAME } from "@/shared/protocol";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "A party game for one screen and everyone's phones.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b1340",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="bg-ink font-sans text-paper antialiased">{children}</body>
    </html>
  );
}
