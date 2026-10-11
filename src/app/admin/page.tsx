import type { Metadata } from "next";
import { Suspense } from "react";
import { TempAdmin } from "@/components/temp/TempAdmin";
import { APP_NAME } from "@/shared/protocol";

export const metadata: Metadata = { title: `${APP_NAME}: Admin`, robots: { index: false } };

// Phase 1 uses a plain test page. The real control panel arrives in Phase 2.
export default function AdminPage() {
  return (
    <Suspense>
      <TempAdmin />
    </Suspense>
  );
}
