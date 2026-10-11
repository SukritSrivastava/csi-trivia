"use client";

import { ordinal } from "@/lib/format";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlayerScreen, Role } from "@/shared/protocol";

type Screen = Extract<PlayerScreen, { kind: "end" }>;

export function EndScreen({ screen, role }: { screen: Screen; role: Role }) {
  const restart = usePlayerStore((s) => s.restart);
  const leave = usePlayerStore((s) => s.leave);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center text-center">
        {role === "audience" || screen.rank === null ? (
          <p className="type-wide text-3xl font-black">Thanks for voting</p>
        ) : (
          <>
            <p className="text-lg font-semibold text-paper/75">You finished</p>
            <p className="type-wide text-7xl font-black">{ordinal(screen.rank)}</p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {screen.canRestart && (
          <button type="button" onClick={restart} className="press bg-marigold py-5 text-2xl font-black text-ink">
            Play again
          </button>
        )}
        <button type="button" onClick={leave} className="py-3 text-base font-bold underline underline-offset-4">
          Leave game
        </button>
      </div>
    </div>
  );
}
