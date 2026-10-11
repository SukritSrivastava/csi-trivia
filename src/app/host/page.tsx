import type { Metadata } from "next";
import { HostApp } from "@/components/host/HostApp";
import { APP_NAME } from "@/shared/protocol";

export const metadata: Metadata = { title: `${APP_NAME}: TV` };

export default function HostPage() {
  return <HostApp />;
}
