"use client";

import { useEffect } from "react";
import { useWakeLock } from "@/lib/useWakeLock";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlayerView } from "@/shared/protocol";
import { AnswerScreen } from "./AnswerScreen";
import { EndScreen } from "./EndScreen";
import { JoinForm } from "./JoinForm";
import { LobbyScreen } from "./LobbyScreen";
import { PlayHeader } from "./PlayHeader";
import { VoteScreen } from "./VoteScreen";
import { WaitScreen } from "./WaitScreen";

/**
 * The phone controller. Like the TV, it only draws what the server sends:
 * one screen at a time, one job at a time.
 */
export function PlayApp() {
  const connect = usePlayerStore((s) => s.connect);
  const view = usePlayerStore((s) => s.view);
  const status = usePlayerStore((s) => s.status);

  useEffect(() => connect(), [connect]);
  useWakeLock(view !== null);

  if (!view) return <JoinForm />;

  return (
    <div className="flex min-h-dvh flex-col bg-ink text-paper">
      <PlayHeader view={view} />
      {status === "offline" && (
        <p className="bg-side-a px-5 py-2 text-center text-sm font-bold text-ink" role="status">
          Reconnecting to the game
        </p>
      )}
      <main className="flex flex-1 flex-col px-5 pt-6 pb-8">
        <Screen view={view} />
      </main>
    </div>
  );
}

function Screen({ view }: { view: PlayerView }) {
  const { screen } = view;
  switch (screen.kind) {
    case "lobby":
      return <LobbyScreen screen={screen} me={view.me} />;
    case "answer":
      return <AnswerScreen key={screen.promptId} screen={screen} view={view} />;
    case "vote":
      return <VoteScreen screen={screen} view={view} />;
    case "wait":
      return <WaitScreen screen={screen} view={view} />;
    case "end":
      return <EndScreen screen={screen} role={view.role} />;
  }
}
