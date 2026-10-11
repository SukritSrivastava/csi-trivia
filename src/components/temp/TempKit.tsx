"use client";

/**
 * TEMPORARY (Phase 1). Bits shared by the plain test pages at /host, /play and
 * /admin. The real screens replace these in Phases 2–4; delete this folder then.
 */
import type { ReactNode } from "react";
import { useCountdown } from "@/lib/useCountdown";
import type { Timer } from "@/shared/protocol";
import type { ConnectionStatus } from "@/stores/hostStore";

export function TempShell({ title, status, children }: { title: string; status: ConnectionStatus; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b-4 border-ink bg-marigold px-4 py-3">
        <h1 className="type-wide text-xl font-black">{title}</h1>
        <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-paper">Temporary test page</span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${status === "online" ? "bg-side-b text-paper" : "bg-side-a text-ink"}`}
          role="status"
        >
          {status === "online" ? "Connected" : status === "connecting" ? "Connecting…" : "Offline: reconnecting…"}
        </span>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">{children}</main>
    </div>
  );
}

export function Card({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-xl border-2 border-ink bg-white/60 p-4" data-testid={testId}>
      {title && <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-ink-soft">{title}</h2>}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "plain",
  big = false,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "plain" | "primary" | "danger" | "good";
  big?: boolean;
  testId?: string;
}) {
  const tones = {
    plain: "bg-paper text-ink",
    primary: "bg-ink text-paper",
    danger: "bg-side-a text-ink",
    good: "bg-side-b text-paper",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`rounded-lg border-2 border-ink font-bold transition active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35 ${tones[tone]} ${
        big ? "px-6 py-4 text-xl" : "px-3 py-2 text-sm"
      }`}
    >
      {children}
    </button>
  );
}

export function Countdown({ timer, clockOffset, paused }: { timer: Timer | null; clockOffset: number; paused: boolean }) {
  const countdown = useCountdown(timer, clockOffset);
  if (!countdown) return <span className="text-ink-soft">no timer</span>;
  return (
    <span className="font-black tabular-nums" data-testid="countdown">
      {paused ? "PAUSED · " : ""}
      {countdown.seconds}s
    </span>
  );
}

export function RawView({ value }: { value: unknown }) {
  return (
    <details className="rounded-xl border-2 border-dashed border-ink-soft bg-white/40 p-3" open>
      <summary className="cursor-pointer text-sm font-bold text-ink-soft">Raw view from the server</summary>
      <pre className="mt-2 max-h-[32rem] overflow-auto text-xs leading-snug">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-bold">
      {label}
      {children}
    </label>
  );
}

export const inputClass = "rounded-lg border-2 border-ink bg-paper px-3 py-2 text-base font-semibold";
