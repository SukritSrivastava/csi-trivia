"use client";

import { useEffect, useState } from "react";
import { ACTION_LABELS, COMMAND_ERROR_TEXT } from "@/lib/adminLabels";
import type { AdminView } from "@/shared/protocol";
import { useAdminStore } from "@/stores/adminStore";

/**
 * The bottom of the Admin screen, always in the same place and in thumb reach:
 * what the next click does (hint), and the big primary button labelled with
 * exactly that. When no click is needed, the slot stays and says why.
 */
export function Dock({ view, pending, onPrimary, onDownload }: { view: AdminView; pending: boolean; onPrimary: () => void; onDownload: () => void }) {
  const error = useCommandError();
  const finished = view.phase === "podium";

  return (
    <div className="border-t border-line bg-void px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-testid="dock">
      {error && (
        <p className="mb-2 text-[15px] leading-snug text-wrong" role="alert" data-testid="command-error">
          {error}
        </p>
      )}
      {view.hint && (view.primary || finished) && (
        <p className="mb-2.5 text-[15px] leading-snug text-mint-soft" data-testid="hint">
          {view.hint}
        </p>
      )}
      {view.primary ? (
        <button
          type="button"
          className="phone-go min-h-16 w-full text-[2.25rem] uppercase transition-transform active:scale-[0.99] disabled:opacity-40"
          onClick={onPrimary}
          disabled={pending}
          aria-keyshortcuts="Space"
          data-testid="primary"
        >
          {pending ? "…" : view.primary.label}
        </button>
      ) : finished ? (
        <button type="button" className="phone-go min-h-16 w-full text-[2.25rem] uppercase" onClick={onDownload} data-testid="primary-csv">
          Download results
        </button>
      ) : (
        // No click needed right now: the slot stays put and says why (the server's hint).
        <div
          className="flex min-h-16 w-full items-center justify-center rounded-[0.9rem] border-2 border-dashed border-line px-4 py-2 text-center text-[15px] leading-snug text-mint-soft"
          role="status"
          data-testid="primary-wait"
        >
          {view.hint ?? "Waiting"}
        </div>
      )}
      <p className="mt-2 hidden text-center text-[14px] text-fog lg:block">
        <Key>Space</Key> next step · <Key>C</Key> correct · <Key>W</Key> wrong · <Key>P</Key> pause/resume · <Key>U</Key> undo last mark
      </p>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="rounded border border-line px-1.5 py-0.5 font-term text-lg leading-none text-mint-soft">{children}</kbd>;
}

/** The last refused command, in plain words, for 4 seconds. Silent for ignored double taps. */
function useCommandError() {
  const lastResult = useAdminStore((s) => s.lastResult);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!lastResult || lastResult.result.ok) return setText(null);
    const msg = COMMAND_ERROR_TEXT[lastResult.result.reason];
    if (!msg) return;
    setText(`${ACTION_LABELS[lastResult.action]}: ${msg}`);
    const t = window.setTimeout(() => setText(null), 4000);
    return () => window.clearTimeout(t);
  }, [lastResult]);

  return text;
}
