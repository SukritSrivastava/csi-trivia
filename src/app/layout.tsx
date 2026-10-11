import type { Metadata, Viewport } from "next";
import { Archivo, Special_Elite, VT323 } from "next/font/google";
import { APP_NAME } from "@/shared/protocol";
import "./globals.css";

/** Words: questions, answers, names, labels (the Jackbox-style typewriter). */
const specialElite = Special_Elite({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-special-elite",
  display: "swap",
});

/** Numbers: answer keys 1–4, the timer, counts, the room code (terminal digits). */
const vt323 = VT323({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-vt323",
  display: "swap",
});

/** Admin only: dense tables and small labels, where a typewriter gets hard to scan. */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "A live quiz for one projector and everyone's phones.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05080a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${specialElite.variable} ${vt323.variable} ${archivo.variable}`}>
      <body className="bg-void font-type text-ghost antialiased">{children}</body>
    </html>
  );
}
