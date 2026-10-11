import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminApp } from "@/components/admin/AdminApp";
import { APP_NAME } from "@/shared/protocol";

export const metadata: Metadata = { title: `${APP_NAME}: Organiser`, robots: { index: false } };

export default function AdminPage() {
  return (
    <Suspense>
      <AdminApp />
    </Suspense>
  );
}
