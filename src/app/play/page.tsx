import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { PlayApp } from "@/components/play/PlayApp";
import { APP_NAME } from "@/shared/protocol";

export const metadata: Metadata = { title: `${APP_NAME}: Play` };

/** Phones: draw under the notch and home bar; the page pads itself with the safe-area insets. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1114",
};

export default function PlayPage() {
  // The join form reads ?code= from the URL (the QR code puts it there).
  // Next.js needs a Suspense boundary around anything that reads search params.
  return (
    <Suspense>
      <PlayApp />
    </Suspense>
  );
}
