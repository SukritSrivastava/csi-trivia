"use client";

import { useEffect, useRef } from "react";
import type { AdminAction, AdminView } from "@/shared/protocol";

/**
 * Laptop keys: Space = primary button, C = Correct, W = Wrong, P = pause/resume,
 * U = undo last mark. Ignored while typing in a field, with modifier keys held,
 * and for actions the server wouldn't accept right now.
 */
export function useShortcuts(view: AdminView | null, send: (action: AdminAction) => void, pending: boolean) {
  const latest = useRef({ view, send, pending });
  latest.current = { view, send, pending };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { view, send, pending } = latest.current;
      if (!view || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;

      const allowed = (type: AdminAction["type"]) => view.allowed.includes(type);
      let action: AdminAction | null = null;
      switch (e.key) {
        case " ":
          e.preventDefault(); // never scroll or click the focused button instead
          if (view.primary && !pending) action = view.primary.action;
          break;
        case "c":
        case "C":
          if (allowed("markCorrect")) action = { type: "markCorrect" };
          break;
        case "w":
        case "W":
          if (allowed("markWrong")) action = { type: "markWrong" };
          break;
        case "p":
        case "P":
          if (allowed(view.paused ? "resume" : "pause")) action = { type: view.paused ? "resume" : "pause" };
          break;
        case "u":
        case "U":
          if (allowed("undoMark")) action = { type: "undoMark" };
          break;
      }
      if (action) send(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
