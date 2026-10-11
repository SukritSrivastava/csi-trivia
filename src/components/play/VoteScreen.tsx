"use client";

import { usePlayerStore } from "@/stores/playerStore";
import type { PlayerScreen, PlayerView } from "@/shared/protocol";

type Screen = Extract<PlayerScreen, { kind: "vote" }>;

/** Same colours as the TV: first answer pink, second teal. */
const SIDE_CLASSES = ["bg-side-a", "bg-side-b"];

export function VoteScreen({ screen }: { screen: Screen; view: PlayerView }) {
  const vote = usePlayerStore((s) => s.vote);
  const votedFor = usePlayerStore((s) => s.votedFor);
  const alreadyVoted = screen.options.some((o) => o.id === votedFor);
  const isDuel = screen.style === "duel";

  if (alreadyVoted) {
    return (
      <div className="flex flex-1 flex-col justify-center text-center">
        <p className="type-wide text-3xl font-black">Vote locked in</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm font-bold text-paper/70">Pick the funnier answer</p>
      <h1 className="mt-1 text-xl font-bold leading-snug text-paper/90 text-balance">{screen.prompt}</h1>

      <div className="mt-5 flex flex-1 flex-col gap-4">
        {screen.options.map((option, i) => (
          <button
            key={option.id}
            type="button"
            onClick={() => vote(option.id)}
            className={`press flex-1 px-4 py-5 text-left text-2xl font-black leading-tight text-ink ${
              isDuel ? SIDE_CLASSES[i] : "bg-paper"
            }`}
            style={{ minHeight: isDuel ? "7rem" : "4.5rem" }}
          >
            {option.text}
          </button>
        ))}
      </div>
    </div>
  );
}
