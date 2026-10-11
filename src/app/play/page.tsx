import type { Metadata } from "next";
import { Suspense } from "react";
import { TempPlay } from "@/components/temp/TempPlay";
import { APP_NAME } from "@/shared/protocol";

export const metadata: Metadata = { title: `${APP_NAME}: Play` };

// Phase 1 uses a plain test page. The real phone screens arrive in Phase 3.
export default function PlayPage() {
  // The join form reads ?code= from the URL (the QR code puts it there).
  // Next.js needs a Suspense boundary around anything that reads search params.
  return (
    <Suspense>
      <TempPlay />
    </Suspense>
  );
}
