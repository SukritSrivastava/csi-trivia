import type { Metadata } from "next";
import { TempHost } from "@/components/temp/TempHost";
import { APP_NAME } from "@/shared/protocol";

export const metadata: Metadata = { title: `${APP_NAME}: Host` };

// Phase 1 uses a plain test page. The real projector screens arrive in Phase 4.
export default function HostPage() {
  return <TempHost />;
}
