import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayApp } from "@/components/play/PlayApp";
import { APP_NAME } from "@/shared/protocol";

export const metadata: Metadata = { title: `${APP_NAME}: Play` };

export default function PlayPage() {
  // PlayApp reads ?code= from the URL (the QR code puts it there).
  // Next.js needs a Suspense boundary around anything that reads search params.
  return (
    <Suspense>
      <PlayApp />
    </Suspense>
  );
}
