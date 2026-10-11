"use client";

import { displayUrl } from "@/lib/format";
import { APP_NAME, type HostView } from "@/shared/protocol";
import { useJoinUrl } from "./useJoinUrl";

/** Always on screen: the quiz name, where we are, and how to join. */
export function HostTopBar({ view }: { view: HostView }) {
  const joinUrl = useJoinUrl(view);
  const { stage } = view;
  const round = "round" in stage ? stage.round : null;
  const where =
    stage.phase === "prediction" || stage.phase === "duel"
      ? "The final"
      : stage.phase === "podium"
        ? "Results"
        : round
          ? `Round ${round.number} of ${round.totalRounds}`
          : null;

  return (
    <header className="flex items-center justify-between gap-[2rem] px-[4rem] pt-[2.5rem] pb-[1rem]">
      <div className="flex items-baseline gap-[1.5rem]">
        <span className="type-wide text-[2rem] font-black tracking-tight">{APP_NAME}</span>
        {where && <span className="text-[1.6rem] font-semibold text-ink-soft">{where}</span>}
      </div>
      <div className="flex items-center gap-[1rem]">
        {stage.phase !== "lobby" && (
          <span className="text-[1.4rem] font-bold">
            {view.activeCount} playing
            {view.audienceCount > 0 && `, ${view.audienceCount} watching`}
          </span>
        )}
        {stage.phase !== "lobby" && (
          <span className="rounded-[0.8rem] bg-ink px-[1.2rem] py-[0.5rem] text-[1.3rem] font-semibold text-paper">
            {displayUrl(joinUrl)}{" "}
            <span className="type-wide ml-[0.4rem] font-black tracking-[0.15em] text-marigold">{view.roomCode}</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen().catch(() => {});
          }}
          className="rounded-[0.8rem] border-[0.2rem] border-ink px-[1rem] py-[0.4rem] text-[1.2rem] font-bold hover:bg-ink hover:text-paper"
        >
          Full screen
        </button>
      </div>
    </header>
  );
}
