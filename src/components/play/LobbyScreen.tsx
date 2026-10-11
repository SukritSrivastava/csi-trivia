"use client";

import { Avatar } from "@/components/ui/Avatar";
import { usePlayerStore } from "@/stores/playerStore";
import { MIN_PLAYERS, type PlayerScreen, type PlayerView } from "@/shared/protocol";

type Screen = Extract<PlayerScreen, { kind: "lobby" }>;

export function LobbyScreen({ screen, me }: { screen: Screen; me: PlayerView["me"] }) {
  const start = usePlayerStore((s) => s.start);
  const missing = Math.max(0, MIN_PLAYERS - screen.playerCount);

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="type-wide text-4xl font-black leading-tight">You&apos;re in</h1>
      <p className="mt-3 text-lg text-paper/80">This is you on the TV.</p>

      <div className="grid flex-1 place-items-center py-8">
        <Avatar name={me.name} color={me.color} size={9} />
      </div>

      <div className="flex flex-col gap-4">
        {me.isVip ? (
          <>
            <p className="text-lg font-semibold">
              {screen.canStart
                ? `${screen.playerCount} players are in. Start when everyone's ready.`
                : `You're the VIP. Waiting for ${missing} more ${missing === 1 ? "player" : "players"}.`}
            </p>
            <button
              type="button"
              disabled={!screen.canStart}
              onClick={start}
              className="press bg-marigold py-5 text-2xl font-black text-ink"
            >
              Everybody&apos;s in, start
            </button>
          </>
        ) : (
          <p className="text-lg font-semibold">The VIP will start the game once everyone has joined.</p>
        )}
      </div>
    </div>
  );
}
