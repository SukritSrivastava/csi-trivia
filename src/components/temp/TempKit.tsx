"use client";

/**
 * TEMPORARY (Phase 1). Bits shared by the test pages at /host, /play and
 * /admin, now in the approved "Server Corridor, Lights Low" look. The real
 * screens replace these in Phases 2–4; delete this folder then.
 */
import type { ReactNode } from "react";
import { useCountdown } from "@/lib/useCountdown";
import type { Timer } from "@/shared/protocol";
import type { ConnectionStatus } from "@/stores/hostStore";

export function TempShell({
  title,
  status,
  children,
  phone = false,
}: {
  title: string;
  status: ConnectionStatus;
  children: ReactNode;
  /** Narrow phone column on the dark teal phone background. */
  phone?: boolean;
}) {
  return (
    <div className={`min-h-dvh font-type text-ghost ${phone ? "phone-bg" : "bg-void"}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel/80 px-4 py-3">
        <h1 className="font-term text-3xl leading-none text-mint [text-shadow:0_0_8px_var(--color-mint)]">{title}</h1>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-fog">temporary</span>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${status === "online" ? "border-mint text-mint" : "border-wrong text-wrong"}`}
          role="status"
        >
          {status === "online" ? "Connected" : status === "connecting" ? "Connecting…" : "Offline: reconnecting…"}
        </span>
      </header>
      <main className={`mx-auto flex flex-col gap-4 p-4 ${phone ? "max-w-md" : "max-w-5xl"}`}>{children}</main>
    </div>
  );
}

export function Card({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-xl border border-line bg-panel/85 p-4" data-testid={testId}>
      {title && <h2 className="mb-3 text-xs tracking-[0.14em] text-mint-soft uppercase">{title}</h2>}
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
  pressed,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "plain" | "primary" | "danger" | "good";
  big?: boolean;
  pressed?: boolean;
  testId?: string;
}) {
  const tones = {
    plain: "border-mint bg-mint/[0.07] text-ghost active:bg-mint/20",
    primary: "border-mint bg-mint font-term text-void",
    danger: "border-wrong bg-wrong/10 text-wrong active:bg-wrong active:text-void",
    good: "border-mint bg-mint font-term text-void",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      data-testid={testId}
      className={`rounded-xl border-2 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 aria-pressed:bg-mint aria-pressed:text-void ${tones[tone]} ${
        big ? (tone === "primary" || tone === "good" ? "px-6 py-3 text-3xl leading-none" : "px-6 py-4 text-xl") : "px-3 py-2 text-sm"
      }`}
    >
      {children}
    </button>
  );
}

export function Countdown({ timer, clockOffset, paused }: { timer: Timer | null; clockOffset: number; paused: boolean }) {
  const countdown = useCountdown(timer, clockOffset);
  if (!countdown) return <span className="text-fog">no timer</span>;
  return (
    <span className="font-term text-amber tabular-nums" data-testid="countdown">
      {paused ? "PAUSED · " : ""}
      {countdown.seconds}s
    </span>
  );
}

export function RawView({ value }: { value: unknown }) {
  return (
    <details className="rounded-xl border border-dashed border-line bg-void/60 p-3">
      <summary className="cursor-pointer text-sm text-fog">Raw view from the server</summary>
      <pre className="mt-2 max-h-[32rem] overflow-auto font-mono text-xs leading-snug text-mint-soft">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-mint-soft">
      {label}
      {children}
    </label>
  );
}

export const inputClass =
  "rounded-xl border-2 border-line bg-void px-3 py-2 font-type text-base text-ghost outline-none focus:border-mint";
