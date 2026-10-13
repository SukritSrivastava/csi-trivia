"use client";

/**
 * Small building blocks of the Admin screen, in the approved "Server Corridor,
 * Lights Low" language: void background, panel cards with a 1px line border,
 * typewriter labels, terminal digits for numbers, mint for actions.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

/** How long an armed destructive button waits for its second tap. */
export const CONFIRM_MS = 3000;

export function Panel({ title, aside, children, className = "", testId }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-4 ${className}`} data-testid={testId}>
      {(title || aside) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h2 className="text-sm tracking-[0.12em] text-mint-soft uppercase">{title}</h2>}
          {aside && <div className="ml-auto">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "plain" | "danger";

/**
 * A secondary control: the phone-opt outline (mint), or wrong-red for
 * destructive ones. At least 56 px tall on Admin, 14 px+ text.
 */
export function ControlButton({
  children,
  onClick,
  disabled,
  tone = "plain",
  armed = false,
  testId,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: Tone;
  /** Waiting for the confirming second tap: filled red. */
  armed?: boolean;
  testId?: string;
  className?: string;
}) {
  const look =
    tone === "danger"
      ? armed
        ? "border-wrong bg-wrong text-void"
        : "border-wrong bg-wrong/[0.07] text-wrong active:bg-wrong/20"
      : "border-mint bg-mint/[0.07] text-ghost active:bg-mint/20";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      data-armed={armed || undefined}
      className={`flex min-h-14 items-center justify-center rounded-[0.9rem] border-2 px-3 py-2 text-center text-[15px] leading-tight transition-[transform,background-color] duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-fog disabled:opacity-60 ${look} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Inline "tap again to confirm" for destructive actions. `arm(key)` on the
 * first tap; a second tap on the same key within 3 s runs it. Cancels itself.
 * No browser dialogs.
 */
export function useConfirm() {
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => window.clearTimeout(t);
  }, [armed]);

  const guard = useCallback(
    (key: string, run: () => void) => {
      if (armed === key) {
        setArmed(null);
        run();
      } else setArmed(key);
    },
    [armed],
  );

  return { armed, guard, cancel: () => setArmed(null) };
}

/** Status dot: mint when connected, wrong-red when not. */
export function Dot({ on, label }: { on: boolean; label?: string }) {
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${on ? "bg-mint" : "border-2 border-wrong"}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
